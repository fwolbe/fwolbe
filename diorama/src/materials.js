import * as THREE from 'three';

// Uniforms shared by every cardboard material, driven by time, weather and daylight.
export const U = {
  uTime: { value: 0 },
  uSnow: { value: 0 },      // 0..1 snow cover on up-facing surfaces
  uWet: { value: 0 },       // 0..1 rain darkening
  uNight: { value: 0 },     // 0..1 how dark it is (windows, lamps)
  uWind: { value: 0.3 },    // 0..1 sway
  uStep: { value: 2 },      // contour step height, for the sheet seams
};

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
        uniform float uTime, uSnow, uWet, uNight, uStep;
        ${NOISE}
        ${opts.fragmentHead || ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${opts.colorBody || ''}
        diffuseColor.rgb *= paper(vW, vWN);
        float snowy = uSnow * smoothstep(.45, .85, vWN.y) * (.75 + .25 * vnoise(vW.xz * .7));
        diffuseColor.rgb = mix(diffuseColor.rgb * (1. - uWet * .28), vec3(.93, .95, .98), snowy);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${opts.emissiveBody || ''}`);
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
