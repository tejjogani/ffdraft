"""A standard-library client for the Pavé CAD RPCs."""

import json
from copy import deepcopy
from http.client import HTTPException
from typing import Any, Iterable, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from uuid import uuid4

JsonObject = dict[str, Any]


class _Omitted:
    pass


_OMITTED = _Omitted()


class RpcError(Exception):
    """Pavé rejected a request. Inspect status, code and details for the reason."""

    def __init__(self, status: int, code: str, message: str, details: JsonObject):
        super().__init__(message)
        self.status = status
        self.code = code
        self.details = details


class TransportError(Exception):
    """The request failed in transit or Pavé did not return a readable response."""


class Studio:
    """Connect to a running Pavé server, such as a local installation."""

    def __init__(self, url: str, *, timeout: float = 60):
        parsed = urlsplit(url)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("Pass the base HTTP or HTTPS URL of your Pavé server")
        self._url = url.rstrip("/")
        self._timeout = timeout

    def project(self, piece_id: str) -> "Project":
        """Open a project and read its current CAD snapshot."""
        return Project(self, piece_id)

    def _rpc(self, command: str, data: JsonObject) -> Any:
        request = Request(
            f"{self._url}/api/rpc/{command}",
            data=json.dumps(data, allow_nan=False).encode("utf-8"),
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=self._timeout) as response:
                return json.load(response)
        except HTTPError as error:
            with error:
                try:
                    payload = json.load(error)
                except (ValueError, OSError, HTTPException):
                    payload = None
            details = payload.get("error") if isinstance(payload, dict) else None
            if isinstance(details, dict):
                code = details.pop("code", "http_error")
                message = details.pop("message", error.reason)
                raise RpcError(error.code, code, message, details) from error
            raise RpcError(
                error.code, "http_error", f"{command} returned HTTP {error.code}", {}
            ) from error
        except (URLError, OSError, HTTPException, ValueError) as error:
            raise TransportError(
                f"Could not read the response to {command}: {error}"
            ) from error


class Project:
    """Read and edit one project's CAD through the server's versioned operations."""

    def __init__(self, studio: Studio, piece_id: str):
        self._studio = studio
        self.id = piece_id
        self._design: JsonObject | None = None
        self._version = 0
        self.refresh()

    @property
    def version(self) -> int:
        """The last observed CAD version, used to guard writes."""
        return self._version

    @property
    def features(self) -> dict[str, JsonObject]:
        """Features keyed by ID in CAD tree order."""
        if self._design is None:
            self.refresh()
        design = self._design
        assert design is not None
        return {
            node_id: deepcopy(design["nodes"][node_id]) for node_id in design["order"]
        }

    def refresh(self) -> "Project":
        """Read the latest version and feature snapshot from the server."""
        piece = self._studio._rpc("pieces.get", {"id": self.id})
        self._design = piece["design"]
        self._version = piece["version"]
        return self

    def modeling_options(self, operation: str | None = None) -> JsonObject:
        """List CAD operations or inspect the inputs and limitations of one operation."""
        fields = {"operation": operation} if operation is not None else {}
        return self._cad_rpc("design.capabilities", **fields)

    def describe(self, feature_id: str) -> JsonObject:
        """Read one feature's values and schema, including field units and limits."""
        return self._cad_rpc("design.describe", nodeId=feature_id)

    def apply(
        self,
        ops: Iterable[JsonObject],
        label: str,
        *,
        base_version: int | None = None,
        change_id: str | None = None,
    ) -> JsonObject:
        """Commit operations at the given version, or at the project's last observed version."""
        result = self._cad_rpc(
            "design.apply",
            ops=list(ops),
            label=label,
            **self._write_guard(base_version, change_id),
        )
        self._record_write(result)
        return result

    def stone_instances(
        self, feature_id: str, *, offset: int = 0, limit: int = 30,
    ) -> JsonObject:
        """Read positions and edit keys for one page of stones in a row, halo or pavé."""
        return self._cad_rpc(
            "design.stoneInstances", nodeId=feature_id, offset=offset, limit=limit,
        )

    def rhino_edges(
        self, feature_id: str, *, offset: int = 0, limit: int = 30,
        edge_index: int | None = None,
    ) -> JsonObject:
        """Read a page of placed Rhino edges or one exact NURBS edge."""
        if edge_index is not None:
            return self._cad_rpc("design.rhinoEdges", nodeId=feature_id, edgeIndex=edge_index)
        return self._cad_rpc("design.rhinoEdges", nodeId=feature_id, offset=offset, limit=limit)

    def duplicate_rhino_edge(
        self, feature_id: str, edge_index: int, new_node_id: str,
        *, at: int | None = None, change_id: str | None = None,
    ) -> JsonObject:
        """Add one independent NURBS curve at the selected project version."""
        selected = self.rhino_edges(feature_id, edge_index=edge_index)
        version = selected["version"]
        if at is not None and at != version:
            raise RpcError(
                409, "conflict",
                f"The piece is at version {version}, not {at}. Select its Rhino edge again.",
                {"currentVersion": version},
            )
        curve = selected.get("curve")
        if curve is None:
            raise ValueError(selected.get("reason") or "This Rhino edge cannot be duplicated.")
        node = {
            "id": new_node_id, "kind": "nurbsCurve",
            "degree": curve["degree"], "knots": curve["knots"],
            "controlPoints": curve["controlPoints"],
        }
        return self.apply(
            [{"t": "add", "node": node}], "Duplicate Rhino edge",
            base_version=version, change_id=change_id,
        )

    def rhino_face_borders(
        self, feature_id: str, *, offset: int = 0, limit: int = 20,
        face_index: int | None = None,
    ) -> JsonObject:
        """Read a page of native face borders or all the exact loops of one face."""
        if face_index is not None:
            return self._cad_rpc("design.rhinoFaceBorders", nodeId=feature_id, faceIndex=face_index)
        return self._cad_rpc("design.rhinoFaceBorders", nodeId=feature_id, offset=offset, limit=limit)

    def duplicate_rhino_face_border(
        self, feature_id: str, face_index: int, new_node_ids: Iterable[str],
        *, at: int | None = None, change_id: str | None = None,
    ) -> JsonObject:
        """Add one independent NURBS curve per loop in a single undoable edit, outer first."""
        selected = self.rhino_face_borders(feature_id, face_index=face_index)
        version = selected["version"]
        if at is not None and at != version:
            raise RpcError(
                409, "conflict",
                f"The piece is at version {version}, not {at}. Select its Rhino face again.",
                {"currentVersion": version},
            )
        curves = selected.get("curves")
        if not curves:
            raise ValueError(selected.get("reason") or "This Rhino face has no supported border.")
        ids = list(new_node_ids) if not isinstance(new_node_ids, str) else []
        if (
            len(ids) != len(curves)
            or any(not isinstance(node_id, str) or not node_id for node_id in ids)
            or len(set(ids)) != len(ids)
        ):
            raise ValueError("Give one unique node ID per face loop, outer first.")
        return self.apply(
            [{
                "t": "add",
                "node": {
                    "id": node_id, "kind": "nurbsCurve", "degree": curve["degree"],
                    "knots": curve["knots"], "controlPoints": curve["controlPoints"],
                },
            } for node_id, curve in zip(ids, curves)],
            "Duplicate Rhino face border",
            base_version=version, change_id=change_id,
        )

    def rhino_cap_faces(self, feature_id: str) -> JsonObject:
        """Read native end-face IDs, project-space normals, thickness, and source version."""
        return self._cad_rpc("design.rhinoCapFaces", nodeId=feature_id)

    def offset_rhino_cap(
        self, feature_id: str, native_asset_id: str, face_index: int, offset_mm: float,
        *, base_version: int, change_id: str | None = None,
    ) -> JsonObject:
        """Offset one native end face in project mm, keeping the opposite end fixed."""
        result = self._cad_rpc(
            "design.offsetRhinoCap", nodeId=feature_id, nativeAssetId=native_asset_id,
            faceIndex=face_index, offsetMm=offset_mm, **self._write_guard(base_version, change_id),
        )
        self._record_write(result)
        return result

    def plan_import_roles(self, choices: list[dict]) -> dict:
        """Preview confirmed Rhino part roles. Use the returned ops and version with apply."""
        return self._cad_rpc("design.planImportRoles", choices=choices)

    def inspect_mount(self, node_ids: Iterable[str]) -> JsonObject:
        """Read selected imported metal members and their cage bounds in project mm."""
        return self._cad_rpc("design.inspectMount", nodeIds=list(node_ids))

    def edit_mount(
        self,
        node_ids: Iterable[str],
        *,
        base_version: int,
        cage: JsonObject | None | _Omitted = _OMITTED,
        fit_gem_id: str | None | _Omitted = _OMITTED,
        material: str | None = None,
        change_id: str | None = None,
    ) -> JsonObject:
        """Commit one mount edit at the inspected version. Pass None to clear a cage or fit."""
        changes: JsonObject = {}
        if cage is not _OMITTED:
            changes["cage"] = cage
        if fit_gem_id is not _OMITTED:
            changes["fitGemId"] = fit_gem_id
        if material is not None:
            changes["material"] = material
        result = self._cad_rpc(
            "design.editMount", nodeIds=list(node_ids), **changes,
            **self._write_guard(base_version, change_id),
        )
        self._record_write(result)
        return result

    def mesh_components(
        self, feature_id: str, *, offset: int = 0, limit: int = 30,
        vertex_ids: Iterable[int] | None = None, face_ids: Iterable[int] | None = None,
    ) -> JsonObject:
        """Read indexed points and triangles in the imported part's source millimetres."""
        args: JsonObject = {"nodeId": feature_id, "offset": offset, "limit": limit}
        if vertex_ids is not None:
            args["vertexIds"] = list(vertex_ids)
        if face_ids is not None:
            args["faceIds"] = list(face_ids)
        return self._cad_rpc("design.meshComponents", **args)

    def set_mesh_vertices(
        self, feature_id: str, asset_id: str, vertices: dict[int, tuple[float, float, float]],
        *, base_version: int, change_id: str | None = None,
    ) -> JsonObject:
        """Set selected vertices to absolute XYZ in source mm using the version from mesh_components."""
        patch = {"meshEdits": {"assetId": asset_id, "vertices": {
            str(vertex): list(point) for vertex, point in vertices.items()
        }}}
        return self.apply(
            [{"t": "update", "id": feature_id, "patch": patch}], "Edit mesh points",
            base_version=base_version, change_id=change_id,
        )

    def loft(
        self, section_ids: list[str], *, feature_id: str, ruled: bool = False,
        capped: bool = True, base_version: int | None = None, change_id: str | None = None,
    ) -> JsonObject:
        """Fit a solid or sheet through ordered project curves. Editing a source rebuilds it."""
        node = {"kind": "loft", "id": feature_id, "sections": section_ids,
                "ruled": ruled, "capped": capped}
        return self.apply([{"t": "add", "node": node}], "Loft sections",
                          base_version=base_version, change_id=change_id)

    def rail_sweep(
        self, rail_ids: list[str], section_ids: list[str], *, feature_id: str,
        capped: bool = True, base_version: int | None = None, change_id: str | None = None,
    ) -> JsonObject:
        """Sweep placed profiles along one or two editable project rails, in input order."""
        node = {"kind": "railSweep", "id": feature_id, "rails": rail_ids,
                "sections": section_ids, "capped": capped}
        return self.apply([{"t": "add", "node": node}], "Sweep sections along rails",
                          base_version=base_version, change_id=change_id)

    def thicken_surface(
        self, surface_id: str, *, feature_id: str, thickness_mm: float,
        base_version: int | None = None, change_id: str | None = None,
    ) -> JsonObject:
        """Thicken an uncapped loft or rail sweep. A negative thickness reverses the side."""
        node = {"kind": "thickenSurface", "id": feature_id, "surface": surface_id,
                "thickness": abs(thickness_mm), "reverse": thickness_mm < 0}
        return self.apply([{"t": "add", "node": node}], "Thicken surface",
                          base_version=base_version, change_id=change_id)

    def revolve_curve(
        self,
        curve_id: str,
        *,
        solid_id: str,
        axis: Literal["vertical", "horizontal"] = "vertical",
        axis_offset_mm: float = 0.0,
        angle_degrees: float = 360.0,
        base_version: int | None = None,
        change_id: str | None = None,
    ) -> JsonObject:
        """Revolve a closed project curve around an axis in its drawing plane."""
        node = {
            "id": solid_id, "kind": "revolve", "curve": curve_id, "axis": axis,
            "axisOffset": axis_offset_mm, "angle": angle_degrees,
        }
        return self.apply(
            [{"t": "add", "node": node}],
            "Revolve profile",
            base_version=base_version,
            change_id=change_id,
        )

    def make_ring_band(
        self,
        curve_id: str,
        *,
        solid_id: str,
        size: JsonObject,
        base_version: int | None = None,
        change_id: str | None = None,
    ) -> JsonObject:
        """Make a circular band from a closed Top or Right profile at plane position zero."""
        node = {"id": solid_id, "kind": "revolve", "curve": curve_id, "size": size}
        return self.apply(
            [{"t": "add", "node": node}],
            "Make ring band",
            base_version=base_version,
            change_id=change_id,
        )

    def make_wire(
        self,
        curve_id: str,
        *,
        wire_id: str,
        width_mm: float,
        thickness_mm: float,
        section: Literal["round", "square", "halfRound"] = "round",
        base_version: int | None = None,
        change_id: str | None = None,
    ) -> JsonObject:
        """Create a metal wire that follows an existing construction curve on this project."""
        node = {
            "id": wire_id,
            "kind": "pipe",
            "curve": curve_id,
            "section": section,
            "width": width_mm,
            "thickness": thickness_mm,
        }
        return self.apply(
            [{"t": "add", "node": node}],
            "Make wire from curve",
            base_version=base_version,
            change_id=change_id,
        )

    def set_prong_tip_offset(
        self,
        feature_id: str,
        prong: int,
        offset_mm: float,
        *,
        base_version: int | None = None,
        change_id: str | None = None,
    ) -> JsonObject:
        """Set the radial offset of one numbered prong tip, in millimetres."""
        if type(prong) is not int or not 1 <= prong <= 8:
            raise ValueError("Prong must be an integer from 1 through 8")
        if not -0.5 <= offset_mm <= 0.5:
            raise ValueError("Prong tip offset must be between -0.5 and 0.5 mm")
        return self.apply(
            [
                {
                    "t": "update",
                    "id": feature_id,
                    "patch": {"prongTipOffsetsMm": {str(prong): offset_mm}},
                }
            ],
            f"Set prong {prong} tip offset",
            base_version=base_version,
            change_id=change_id,
        )

    def set_band_thickness(
        self,
        feature_id: str,
        *,
        base_mm: float,
        base_version: int | None = None,
        change_id: str | None = None,
    ) -> JsonObject:
        """Set the thickness of the base of a ring band in millimetres."""
        return self.apply(
            [{"t": "update", "id": feature_id, "patch": {"thicknessBottom": base_mm}}],
            "Set band thickness at base",
            base_version=base_version,
            change_id=change_id,
        )

    def replace_stone(
        self,
        feature_id: str,
        *,
        carat: float | None = None,
        fit: JsonObject | None = None,
        dry_run: bool = False,
        base_version: int | None = None,
        change_id: str | None = None,
    ) -> JsonObject:
        """Resize a stone by carats or fit a measured supplier stone and adjust its mount."""
        if (carat is None) == (fit is None):
            raise ValueError("Pass exactly one of carat or fit")
        change = {"carat": carat} if fit is None else {"fit": fit}
        guard = {} if dry_run else self._write_guard(base_version, change_id)
        result = self._cad_rpc(
            "design.replaceStone",
            target={"nodeId": feature_id},
            change=change,
            dryRun=dry_run,
            **guard,
        )
        if result["applied"]:
            self._record_write(result)
        return result

    def history(
        self, *, limit: int = 50, before: int | None = None
    ) -> list[JsonObject]:
        """Read saved CAD edits, newest first. Pass before to read earlier entries."""
        paging = {} if before is None else {"before": before}
        return self._cad_rpc("design.history", limit=limit, **paging)

    def undo(self, seq: int) -> JsonObject:
        """Revert a saved change by its history sequence number."""
        result = self._cad_rpc("design.revert", seq=seq)
        self._record_write(result)
        return result

    def evaluate(
        self, *, detail: Literal["draft", "production"] = "draft"
    ) -> JsonObject:
        """Compute current metal weight, carats, other geometry facts and diagnostics."""
        return self._cad_rpc("design.evaluate", detail=detail)

    def _cad_rpc(self, command: str, **data: Any) -> Any:
        return self._studio._rpc(command, {"pieceId": self.id, **data})

    def _write_guard(
        self, base_version: int | None, change_id: str | None
    ) -> JsonObject:
        return {
            "baseVersion": self.version if base_version is None else base_version,
            "changeId": f"chg_{uuid4().hex}" if change_id is None else change_id,
        }

    def _record_write(self, result: JsonObject) -> None:
        version = result["version"]
        if version > self._version:
            self._version = version
            self._design = None
