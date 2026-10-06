import { VERT, FLOOR_FRAG, FRAME_FRAG } from './shaders.js';

// Sub-pixel sample offsets for the floor: the R2 low-discrepancy sequence.
const R2 = [0.7548776662466927, 0.5698402909980532];

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || 'shader compile failed');
  }
  return shader;
}

function link(gl, fragSource) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'program link failed');
  }
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const { name } = gl.getActiveUniform(program, i);
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return { program, uniforms };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    if (!this.gl) throw new Error('WebGL2 is not available');
    this.camera = { position: [0, 1, 1], tanHalfFov: 0.5, lensShift: 0 };
    this.frame = 0;
    this.init();
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => this.init());
  }

  init() {
    const gl = this.gl;
    this.floorPass = link(gl, FLOOR_FRAG);
    this.framePass = link(gl, FRAME_FRAG);
    gl.bindVertexArray(gl.createVertexArray());
    // Half-float lets the floor accumulate in linear light without banding.
    this.float = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.floorTex = null;
    this.floorFbo = gl.createFramebuffer();
    this.allocateFloor();
  }

  allocateFloor() {
    const gl = this.gl;
    const { width, height } = this.canvas;
    if (this.floorTex) gl.deleteTexture(this.floorTex);
    this.floorTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.floorTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.floorFbo);
    const attach = (internal, type) => {
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, type, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.floorTex, 0);
      return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    };
    if (!this.float || !attach(gl.RGBA16F, gl.HALF_FLOAT)) {
      this.float = false;
      attach(gl.RGBA8, gl.UNSIGNED_BYTE);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // An 8-bit target stops converging after a few blends, so it gets fewer samples.
    this.sampleTarget = this.float ? 64 : 8;
    this.samples = 0;
  }

  get baking() {
    return this.samples < this.sampleTarget;
  }

  resize(width, height) {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.allocateFloor();
  }

  setCamera(camera) {
    this.camera = camera;
    this.samples = 0;
  }

  setView(pass) {
    const gl = this.gl;
    const { position, tanHalfFov, lensShift } = this.camera;
    gl.useProgram(pass.program);
    gl.uniform2f(pass.uniforms.uRes, this.canvas.width, this.canvas.height);
    gl.uniform3fv(pass.uniforms.uCam, position);
    gl.uniform2f(pass.uniforms.uLens, tanHalfFov, lensShift);
  }

  // Adds one jittered sample to the floor texture as a running average.
  bakeFloor() {
    const gl = this.gl;
    const { width, height } = this.canvas;
    const n = this.samples;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.floorFbo);
    gl.viewport(0, 0, width, height);
    if (n === 0) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    // Nothing above the horizon is floor.
    const horizon = Math.ceil(height * (0.5 + 0.5 * this.camera.lensShift)) + 2;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, width, Math.min(height, horizon));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const pass = this.floorPass;
    this.setView(pass);
    gl.uniform2f(pass.uniforms.uJitter, ((0.5 + R2[0] * n) % 1) - 0.5, ((0.5 + R2[1] * n) % 1) - 0.5);
    gl.uniform1f(pass.uniforms.uWeight, 1 / (n + 1));
    gl.uniform1f(pass.uniforms.uEncode, this.float ? 0 : 1);
    gl.uniform1i(pass.uniforms.uSample, n);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    this.samples = n + 1;
  }

  // pose: { position: [x, y, z], axes: [a, b, c], rotation: mat3 (column-major) }
  render(pose) {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    if (this.baking) this.bakeFloor();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const pass = this.framePass;
    this.setView(pass);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.floorTex);
    gl.uniform1i(pass.uniforms.uFloor, 0);
    gl.uniform1f(pass.uniforms.uDecode, this.float ? 0 : 1);
    gl.uniform3fv(pass.uniforms.uBallPos, pose.position);
    gl.uniform3fv(pass.uniforms.uBallAxes, pose.axes);
    gl.uniformMatrix3fv(pass.uniforms.uBallRot, false, pose.rotation);
    gl.uniform1f(pass.uniforms.uRadius, pose.radius);
    gl.uniform1i(pass.uniforms.uFrame, this.frame++ & 0xffff);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
