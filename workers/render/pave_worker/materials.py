# SPDX-License-Identifier: GPL-3.0-or-later
"""Cycles materials from resolved material records (research §2 "Mapping to renderers").

Metals: Metallic BSDF in F82 mode. Transparent gems: Principled BSDF with native dispersion
(Blender 5.3) and Beer–Lambert volume absorption. Opaque stones: Principled surface.
"""

from __future__ import annotations

import math

import bpy

from .job import MM, Material, Relief

Node = bpy.types.ShaderNode


def _tree(name: str) -> tuple[bpy.types.Material, bpy.types.NodeTree, Node]:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    return mat, tree, out


def _rgba(c: tuple[float, float, float]) -> tuple[float, float, float, float]:
    return (c[0], c[1], c[2], 1.0)


def _relief(tree: bpy.types.NodeTree, relief: Relief) -> bpy.types.NodeSocket:
    """A bump-mapped normal in object space (metres, which equals the piece frame — see scene.py)."""
    coords = tree.nodes.new("ShaderNodeTexCoord")
    size = relief["sizeMm"] * MM
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = relief["strength"]
    if relief["kind"] == "cells":
        # Hammered: each Voronoi cell is a spherical dimple, height ∝ distance² from its centre.
        cells = tree.nodes.new("ShaderNodeTexVoronoi")
        cells.inputs["Scale"].default_value = 1.0 / size
        tree.links.new(coords.outputs["Object"], cells.inputs["Vector"])
        square = tree.nodes.new("ShaderNodeMath")
        square.operation = "POWER"
        square.inputs[1].default_value = 2.0
        tree.links.new(cells.outputs["Distance"], square.inputs[0])
        bump.inputs["Distance"].default_value = size * 0.3
        tree.links.new(square.outputs[0], bump.inputs["Height"])
    else:
        grain = tree.nodes.new("ShaderNodeTexNoise")
        grain.inputs["Scale"].default_value = 1.0 / size
        grain.inputs["Detail"].default_value = 2.0
        tree.links.new(coords.outputs["Object"], grain.inputs["Vector"])
        bump.inputs["Distance"].default_value = size * 0.5
        tree.links.new(grain.outputs["Fac"], bump.inputs["Height"])
    return bump.outputs["Normal"]


def _metal(name: str, m: Material) -> bpy.types.Material:
    mat, tree, out = _tree(name)
    bsdf = tree.nodes.new("ShaderNodeBsdfMetallic")
    bsdf.fresnel_type = "F82"
    bsdf.inputs["Base Color"].default_value = _rgba(m["color"])
    bsdf.inputs["Edge Tint"].default_value = _rgba(m["edgeTint"])
    bsdf.inputs["Roughness"].default_value = m["roughness"]
    if m["anisotropy"] > 0:
        bsdf.inputs["Anisotropy"].default_value = m["anisotropy"]
        tangent = tree.nodes.new("ShaderNodeTangent")
        tangent.direction_type = "RADIAL"
        axis = m["brushAxis"]
        tangent.axis = "XYZ"[max(range(3), key=lambda i: abs(axis[i]))]
        tree.links.new(tangent.outputs["Tangent"], bsdf.inputs["Tangent"])
    relief = m.get("relief")
    if relief:
        tree.links.new(_relief(tree, relief), bsdf.inputs["Normal"])
    tree.links.new(bsdf.outputs[0], out.inputs["Surface"])
    return mat


def _gem(name: str, m: Material) -> bpy.types.Material:
    mat, tree, out = _tree(name)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.0
    bsdf.inputs["IOR"].default_value = m["ior"]
    bsdf.inputs["Transmission Weight"].default_value = 1.0
    bsdf.inputs["Transmission Dispersion Scale"].default_value = 1.0
    bsdf.inputs["Transmission Dispersion Abbe Number"].default_value = m["abbe"]
    tree.links.new(bsdf.outputs[0], out.inputs["Surface"])

    # σ = −ln(colour) / distance per channel; density = max σ, colour = 1 − σ / density.
    distance = m["attenuationDistance"] * MM
    sigma = [-math.log(max(c, 1e-6)) / distance for c in m["attenuationColor"]]
    density = max(sigma)
    if density > 0:
        volume = tree.nodes.new("ShaderNodeVolumeAbsorption")
        volume.inputs["Density"].default_value = density
        volume.inputs["Color"].default_value = _rgba(tuple(1 - s / density for s in sigma))  # type: ignore[arg-type]
        tree.links.new(volume.outputs[0], out.inputs["Volume"])
    return mat


def _surface(name: str, m: Material) -> bpy.types.Material:
    mat, tree, out = _tree(name)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = _rgba(m["color"])
    bsdf.inputs["Roughness"].default_value = m["roughness"]
    bsdf.inputs["IOR"].default_value = m["ior"]
    if m["subsurfaceMm"] > 0:
        bsdf.inputs["Subsurface Weight"].default_value = 1.0
        bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.8, 0.6)
        bsdf.inputs["Subsurface Scale"].default_value = m["subsurfaceMm"] * MM
    film = m.get("thinFilm")
    if film:
        # Orient / play of colour: film thickness varies over the surface within the range.
        noise = tree.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 400.0
        remap = tree.nodes.new("ShaderNodeMapRange")
        remap.inputs["To Min"].default_value = film[0]
        remap.inputs["To Max"].default_value = film[1]
        tree.links.new(noise.outputs["Fac"], remap.inputs["Value"])
        tree.links.new(remap.outputs["Result"], bsdf.inputs["Thin Film Thickness"])
    if m["coat"] > 0:
        bsdf.inputs["Coat Weight"].default_value = m["coat"]
    tree.links.new(bsdf.outputs[0], out.inputs["Surface"])
    return mat


_BUILDERS = {"metal": _metal, "gem": _gem, "surface": _surface}


def build_materials(materials: dict[str, Material]) -> dict[str, bpy.types.Material]:
    return {key: _BUILDERS[m["kind"]](key, m) for key, m in materials.items()}
