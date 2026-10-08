// Surface material IDs stored per vertex (normal.w byte). The fragment shader
// layers procedural detail (grain, weave, speckle, specular) on top of the
// vertex colour according to the material, so no texture files are shipped.
export const MAT = {
  FLAT: 0,
  PLANK: 1, // sawn wood, grain runs horizontally
  LOG: 2, // round timber, grain runs along the length
  BARK: 3,
  FOLIAGE: 4,
  GROUND: 5, // terrain
  METAL: 6,
  CLOTH: 7,
  SKIN: 8,
  STONE: 9,
  CANVAS: 10,
  GRASS: 11, // grass blades
  PAINT: 12, // painted metal / plastic
  LEATHER: 13,
};
