import * as THREE from 'three';

// Tilt-shift: a clear horizontal band, blur growing above and below it.
export const TiltShiftShader = {
  uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2(1, 0) }, amount: { value: 6 }, focus: { value: .52 }, band: { value: .14 }, res: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 dir, res; uniform float amount, focus, band; varying vec2 vUv;
    void main(){
      float d = max(0., abs(vUv.y - focus) - band);
      float b = amount * pow(d * 2.2, 1.35);
      vec2 st = dir / res * b;
      vec4 s = texture2D(tDiffuse, vUv) * .1964;
      s += (texture2D(tDiffuse, vUv + st * 1.4118) + texture2D(tDiffuse, vUv - st * 1.4118)) * .2969;
      s += (texture2D(tDiffuse, vUv + st * 3.2941) + texture2D(tDiffuse, vUv - st * 3.2941)) * .0941;
      s += (texture2D(tDiffuse, vUv + st * 5.1765) + texture2D(tDiffuse, vUv - st * 5.1765)) * .0104;
      gl_FragColor = s;
    }`,
};

// Final grade: warm vignette, a touch of saturation and paper grain.
export const FinishShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, vignette: { value: .32 }, night: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, vignette, night; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(.299, .587, .114));
      c.rgb = mix(vec3(l), c.rgb, 1.08);
      vec2 q = vUv - .5;
      float v = 1. - dot(q, q) * vignette * 2.2;
      c.rgb *= mix(vec3(1.), vec3(1., .96, .9), .35) * v;
      c.rgb += (h(vUv * 913. + time) - .5) * .018;
      gl_FragColor = c;
    }`,
};
