"""Exercise the public client on the disposable sleeve created by the Studio browser smoke."""
import sys
from urllib.parse import urlsplit

from pave import Studio


def check(url: str, piece_id: str, node_id: str) -> None:
    if urlsplit(url).hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("Pass the disposable loopback server used by the browser test.")
    project = Studio(url).project(piece_id)
    source = project.features[node_id]
    read = project.rhino_cap_faces(node_id)
    face = next(f for f in read["faces"] if f["normal"][2] > 0.99)
    assert face["innerLoops"] == 1
    cap = project.offset_rhino_cap(
        node_id, read["nativeAssetId"], face["faceIndex"], 0.25,
        base_version=read["version"],
    )
    inspected = project.rhino_cap_faces(node_id)
    moved = next(f for f in inspected["faces"] if f["faceIndex"] == face["faceIndex"])
    assert abs(moved["spanMm"] - face["spanMm"] - 0.25) < 1e-8
    assert moved["innerLoops"] == 1
    edges = project.rhino_edges(node_id)
    rim = next(edge for edge in edges["edges"] if edge["closed"])
    exact = project.rhino_edges(node_id, edge_index=rim["edgeIndex"])["curve"]
    curve = project.duplicate_rhino_edge(node_id, rim["edgeIndex"], "python-rim", at=edges["version"])
    copied = project.features["python-rim"]
    assert copied["kind"] == "nurbsCurve"
    for key in ("controlPoints", "degree", "knots"):
        assert copied[key] == exact[key]
    project.undo(curve["version"])
    project.undo(cap["version"])
    assert project.features[node_id] == source and "python-rim" not in project.features
    before = project.features
    border = project.rhino_face_borders(node_id, face_index=face["faceIndex"])
    assert [loop["kind"] for loop in border["curves"]] == ["outer", "inner"]
    curve_ids = ["python-outer-border", "python-inner-border"]
    border_change = project.duplicate_rhino_face_border(
        node_id, face["faceIndex"], curve_ids, at=border["version"],
    )
    features = project.features
    for curve_id, loop in zip(curve_ids, border["curves"]):
        assert features[curve_id]["kind"] == "nurbsCurve"
        assert "sourceObjectId" not in features[curve_id]
        for key in ("degree", "knots", "controlPoints"):
            assert features[curve_id][key] == loop[key]
    assert features[node_id] == source
    project.undo(border_change["version"])
    assert project.features == before
    print("Python client verified native face offset, exact edge and both face borders, including undo.")


if __name__ == "__main__":
    check(*sys.argv[1:])
