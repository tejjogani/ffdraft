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
        carat: float,
        dry_run: bool = False,
        base_version: int | None = None,
        change_id: str | None = None,
    ) -> JsonObject:
        """Set a stone's weight in carats, letting the setting adjust with the stone."""
        guard = {} if dry_run else self._write_guard(base_version, change_id)
        result = self._cad_rpc(
            "design.replaceStone",
            target={"nodeId": feature_id},
            change={"carat": carat},
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
