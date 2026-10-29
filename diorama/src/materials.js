import * as THREE from 'three';

// Uniforms shared by every cardboard material, driven by time, weather and daylight.
export const U = {
  uTime: { value: 0 },
  uSnow: { value: 0 },      // 0..1 snow cover on up-facing surfaces
  uWet: { value: 0 },       // 0..1 rain darkening
  uNight: { value: 0 },     // 0..1 how dark it is (windows, lamps)
  uWind: { value: 0.3 },    // 0..1 sway
  uStep: { value: 2 },      // contour step height, for the sheet seams
  uStyle: { value: 0 },     // 0 cardboard, 1 white architect's model, 2 needle felt
};
export const STYLES = { cardboard: 0, white: 1, felt: 2 };

// How each style recolours a surface; CAT_* says what kind of thing it is.
const STYLE_GLSL = /* glsl */`
  float feltFibre(vec3 w, vec3 n){
    vec2 q = abs(n.y) > .5 ? w.xz : (abs(n.x) > abs(n.z) ? w.zy : w.xy);
    float px = fwidth(q.x * 14.) + fwidth(q.y * 14.);
    float f = vnoise(q * 14.) * .5 + vnoise(vec2(q.x * 31., q.y * 9.) + 7.) * .5;
    float blob = vnoise(q * 2.5) * .55 + vnoise(q * 6.) * .45;
    return mix(f, .5, clamp(px * .5, 0., 1.)) * .45 + blob * .55;
  }
  vec3 styleColor(vec3 c, vec3 w, vec3 n){
    if (uStyle < .5) return c;
    float l = dot(c, vec3(.299, .587, .114));
    if (uStyle < 1.5) {
      #if defined(CAT_GREEN)
        return vec3(.47, .56, .40) * (.78 + .44 * vnoise(w.xz * 4.1 + w.y * 6.3));
      #elif defined(CAT_TRUNK)
        return vec3(.66, .54, .40);
      #elif defined(CAT_ROAD)
        return vec3(.72, .71, .69) * (.97 + .06 * vnoise(w.xz * 2.));
      #elif defined(CAT_DARK)
        return vec3(.45, .45, .46);
      #elif defined(CAT_KEEP)
        return c;
      #else
        return vec3(.95, .935, .905) * (.96 + .06 * l);
      #endif
    }
    // needle felt: richer, softer colour with visible fibres
    vec3 f = mix(vec3(l), c, 1.12);
    f = mix(f, vec3(l) * 1.02 + .05, .16);              // chalky, dyed-wool colour
    return f * (.74 + .42 * feltFibre(w, n));
  }
`;

const NOISE = /* glsl */`
  float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
  float paper(vec3 w, vec3 n){
    vec2 q = abs(n.y) > .5 ? w.xz : (abs(n.x) > abs(n.z) ? w.zy : w.xy);
    float g = vnoise(q * 3.1) * .5 + vnoise(q * 11.0) * .3 + vnoise(q * .55) * .6;
    float fib = smoothstep(.72, 1., vnoise(vec2(q.x * 2.0 + q.y * 7.0, q.y * .7)));
    return .9 + g * .12 - fib * .05;
  }
`;

// Patch a standard material: paper grain, snow on top faces, wet darkening, optional extra GLSL.
export function cardboard(mat, opts = {}) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, opts.uniforms || {});
    mat.userData.shader = sh;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vW; varying vec3 vWN; uniform float uTime; uniform float uWind;
        ${opts.vertexHead || ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${opts.vertexBody || ''}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 wpos4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpos4 = instanceMatrix * wpos4;
        #endif
        vW = (modelMatrix * wpos4).xyz;
        vec3 objN = objectNormal;
        #ifdef USE_INSTANCING
          objN = mat3(instanceMatrix) * objN;
        #endif
        vWN = normalize(mat3(modelMatrix) * objN);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vW; varying vec3 vWN;
        uniform float uTime, uSnow, uWet, uNight, uStep, uStyle;
        ${opts.cat ? '#define CAT_' + opts.cat : ''}
        ${NOISE}
        ${STYLE_GLSL}
        ${opts.fragmentHead || ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${opts.colorBody || ''}
        if (uStyle < 1.5) diffuseColor.rgb *= paper(vW, vWN);
        #ifndef CAT_SELF
        diffuseColor.rgb = styleColor(diffuseColor.rgb, vW, vWN);
        #endif
        float snowy = uSnow * smoothstep(.45, .85, vWN.y) * (.75 + .25 * vnoise(vW.xz * .7));
        diffuseColor.rgb = mix(diffuseColor.rgb * (1. - uWet * .28), vec3(.93, .95, .98), snowy);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${opts.emissiveBody || ''}
        if (uStyle > 1.5) {
          // wool catches light at grazing angles
          float rim = 1. - abs(dot(normalize(normal), normalize(vViewPosition)));
          totalEmissiveRadiance += diffuseColor.rgb * pow(rim, 1.8) * .5 * (1. - uNight * .85);
        }`);
  };
  mat.customProgramCacheKey = () => (opts.key || 'cb') + (mat.vertexColors ? 'v' : '');
  return mat;
}

// Riser walls and slab sides: kraft board with sheet seams and corrugated flutes.
export const WALL_GLSL = /* glsl */`
  vec3 kraft(vec3 w, vec3 n, float step){
    float h = abs(n.x) > abs(n.z) ? w.z : w.x;
    float lay = fract(w.y / step);
    float px = fwidth(w.y / step);
    float seam = 1. - smoothstep(0., max(px * 1.5, .04), lay) * smoothstep(0., max(px * 1.5, .04), 1. - lay);
    float flutePx = fwidth(h / .5);
    float flute = .5 + .5 * sin(h / .5 * 6.2832);
    float inner = smoothstep(.18, .24, lay) * smoothstep(.18, .24, 1. - lay);
    float fl = mix(.82 + .18 * flute, .91, clamp(flutePx * 1.5, 0., 1.));
    vec3 c = vec3(.74, .58, .39);
    c *= mix(1., fl, inner);
    c = mix(c, vec3(.36, .25, .15), seam * .8);
    return c;
  }
`;
