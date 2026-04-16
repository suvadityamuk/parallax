/**
 * SplatViewer — WebGL2-based 3D Gaussian Splat renderer.
 *
 * Renders splats as billboard quads oriented toward the camera.
 * Supports orbit rotation ±30° with spring-back physics.
 * Shows shimmer loading overlay during initial generation.
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import type { SplatData } from '../hooks/useSplat';
import './SplatViewer.css';

interface SplatViewerProps {
  scene: SplatData | null;
  sceneVersion: number;
  isLoading: boolean;
  splatCount: number;
  processingMs: number;
}

const MAX_ROTATION_DEG = 30;
const SPRING_STIFFNESS = 0.08;
const SPRING_DAMPING = 0.85;

export function SplatViewer({
  scene,
  sceneVersion,
  isLoading,
  splatCount,
  processingMs,
}: SplatViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const vaoRef = useRef<WebGLVertexArrayObject | null>(null);

  // Orbit state
  const rotationRef = useRef({ yaw: 0, pitch: 0 });
  const velocityRef = useRef({ yaw: 0, pitch: 0 });
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const animFrameRef = useRef<number>(0);
  const [rotation, setRotation] = useState({ yaw: 0, pitch: 0 });
  const drawCountRef = useRef(0);

  // Initialize WebGL2
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
    });
    if (!gl) {
      console.error('[SplatViewer] WebGL2 not available');
      return;
    }
    glRef.current = gl;

    // Vertex shader — billboard quads
    const vsSource = `#version 300 es
      precision highp float;

      layout(location = 0) in vec3 a_position;
      layout(location = 1) in vec3 a_color;
      layout(location = 2) in float a_scale;
      layout(location = 3) in float a_opacity;

      uniform mat4 u_viewProjection;
      uniform float u_pointSize;

      out vec3 v_color;
      out float v_opacity;

      void main() {
        gl_Position = u_viewProjection * vec4(a_position, 1.0);
        gl_PointSize = max(1.0, a_scale * u_pointSize / gl_Position.w);
        v_color = a_color;
        v_opacity = a_opacity;
      }
    `;

    // Fragment shader — soft circle with alpha
    const fsSource = `#version 300 es
      precision highp float;

      in vec3 v_color;
      in float v_opacity;
      out vec4 fragColor;

      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float dist = length(d);
        if (dist > 0.5) discard;

        float alpha = v_opacity * smoothstep(0.5, 0.3, dist);
        fragColor = vec4(v_color, alpha);
      }
    `;

    const program = createShaderProgram(gl, vsSource, fsSource);
    if (!program) return;
    programRef.current = program;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0.05, 0.05, 0.1, 0.0);

    return () => {
      if (programRef.current) gl.deleteProgram(programRef.current);
      if (vaoRef.current) gl.deleteVertexArray(vaoRef.current);
    };
  }, []);

  // Update splat buffers when scene changes
  useEffect(() => {
    const gl = glRef.current;
    const program = programRef.current;
    if (!gl || !program || !scene) return;

    // Clean up previous VAO
    if (vaoRef.current) {
      gl.deleteVertexArray(vaoRef.current);
    }

    const vao = gl.createVertexArray();
    if (!vao) return;
    gl.bindVertexArray(vao);
    vaoRef.current = vao;

    const n = scene.positions.length;
    drawCountRef.current = n;

    // Flatten position data
    const posData = new Float32Array(n * 3);
    const colData = new Float32Array(n * 3);
    const scaleData = new Float32Array(n);
    const opacityData = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      posData[i * 3] = scene.positions[i][0];
      posData[i * 3 + 1] = scene.positions[i][1];
      posData[i * 3 + 2] = scene.positions[i][2];

      colData[i * 3] = scene.colors[i][0];
      colData[i * 3 + 1] = scene.colors[i][1];
      colData[i * 3 + 2] = scene.colors[i][2];

      scaleData[i] = scene.scales[i]
        ? (scene.scales[i][0] + scene.scales[i][1] + scene.scales[i][2]) / 3
        : 0.01;
      opacityData[i] = scene.opacities[i];
    }

    // Position buffer
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, posData, gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    // Color buffer
    const colBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, colData, gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(1);

    // Scale buffer
    const scaleBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, scaleBuf);
    gl.bufferData(gl.ARRAY_BUFFER, scaleData, gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(2);

    // Opacity buffer
    const opaBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, opaBuf);
    gl.bufferData(gl.ARRAY_BUFFER, opacityData, gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(3);

    gl.bindVertexArray(null);

    return () => {
      gl.deleteBuffer(posBuf);
      gl.deleteBuffer(colBuf);
      gl.deleteBuffer(scaleBuf);
      gl.deleteBuffer(opaBuf);
    };
  }, [scene, sceneVersion]);

  // Render loop
  useEffect(() => {
    const render = () => {
      const gl = glRef.current;
      const program = programRef.current;
      const vao = vaoRef.current;
      const canvas = canvasRef.current;

      if (!gl || !program || !vao || !canvas) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }

      // Update canvas size
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }

      // Spring-back physics for rotation
      if (!isDraggingRef.current) {
        const rot = rotationRef.current;
        const vel = velocityRef.current;

        // Spring toward center
        vel.yaw = vel.yaw * SPRING_DAMPING - rot.yaw * SPRING_STIFFNESS;
        vel.pitch = vel.pitch * SPRING_DAMPING - rot.pitch * SPRING_STIFFNESS;

        rot.yaw += vel.yaw;
        rot.pitch += vel.pitch;

        // Clamp
        rot.yaw = Math.max(-MAX_ROTATION_DEG, Math.min(MAX_ROTATION_DEG, rot.yaw));
        rot.pitch = Math.max(-MAX_ROTATION_DEG / 2, Math.min(MAX_ROTATION_DEG / 2, rot.pitch));

        setRotation({ yaw: rot.yaw, pitch: rot.pitch });
      }

      // Clear
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // Compute view-projection matrix
      const aspect = canvas.width / canvas.height;
      const fov = 60 * Math.PI / 180;
      const near = 0.1;
      const far = 100.0;

      const projection = perspectiveMatrix(fov, aspect, near, far);
      const yawRad = rotationRef.current.yaw * Math.PI / 180;
      const pitchRad = rotationRef.current.pitch * Math.PI / 180;

      // Camera orbit around scene center
      const dist = 2.5;
      const eyeX = dist * Math.sin(yawRad) * Math.cos(pitchRad);
      const eyeY = dist * Math.sin(pitchRad);
      const eyeZ = dist * Math.cos(yawRad) * Math.cos(pitchRad);

      const view = lookAtMatrix(
        [eyeX, eyeY, eyeZ],
        [0, 0, 1.5], // Look at scene center
        [0, 1, 0]
      );

      const vp = multiplyMatrices(projection, view);

      // Draw
      gl.useProgram(program);

      const vpLoc = gl.getUniformLocation(program, 'u_viewProjection');
      gl.uniformMatrix4fv(vpLoc, false, vp);

      const psLoc = gl.getUniformLocation(program, 'u_pointSize');
      gl.uniform1f(psLoc, Math.min(canvas.width, canvas.height) * 0.8);

      gl.bindVertexArray(vao);
      gl.drawArrays(gl.POINTS, 0, drawCountRef.current);
      gl.bindVertexArray(null);

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // Mouse / touch orbit controls
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDraggingRef.current = true;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;

    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };

    const rot = rotationRef.current;
    rot.yaw = Math.max(-MAX_ROTATION_DEG, Math.min(MAX_ROTATION_DEG, rot.yaw + dx * 0.3));
    rot.pitch = Math.max(-MAX_ROTATION_DEG / 2, Math.min(MAX_ROTATION_DEG / 2, rot.pitch + dy * 0.3));

    velocityRef.current = { yaw: dx * 0.3, pitch: dy * 0.3 };
    setRotation({ yaw: rot.yaw, pitch: rot.pitch });
  }, []);

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  // Vignette intensity based on rotation
  const rotMagnitude = Math.sqrt(rotation.yaw ** 2 + rotation.pitch ** 2) / MAX_ROTATION_DEG;
  const vignetteOpacity = Math.min(0.4, rotMagnitude * 0.5);

  return (
    <div className="splat-viewer-container">
      {/* Loading shimmer */}
      {isLoading && (
        <div className="splat-shimmer">
          <div className="splat-shimmer-text">
            <span className="splat-shimmer-icon">🧊</span>
            Generating 3D...
          </div>
        </div>
      )}

      {/* WebGL canvas */}
      <canvas
        ref={canvasRef}
        className="splat-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />

      {/* Rotation vignette */}
      <div
        className="splat-vignette"
        style={{ opacity: vignetteOpacity }}
      />

      {/* Stats badge */}
      {scene && (
        <div className="splat-stats">
          <span>{splatCount.toLocaleString()} splats</span>
          <span>•</span>
          <span>{processingMs.toFixed(0)}ms</span>
        </div>
      )}
    </div>
  );
}

// ── WebGL helpers ────────────────────────────────────────

function createShaderProgram(
  gl: WebGL2RenderingContext,
  vsSource: string,
  fsSource: string
): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) return null;

  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[SplatViewer] Program link failed:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[SplatViewer] Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

function perspectiveMatrix(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1.0 / Math.tan(fov / 2);
  const nf = 1 / (near - far);

  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function lookAtMatrix(eye: number[], center: number[], up: number[]): Float32Array {
  const zx = eye[0] - center[0];
  const zy = eye[1] - center[1];
  const zz = eye[2] - center[2];
  let len = 1 / Math.sqrt(zx * zx + zy * zy + zz * zz);
  const z0 = zx * len, z1 = zy * len, z2 = zz * len;

  const x0 = up[1] * z2 - up[2] * z1;
  const x1 = up[2] * z0 - up[0] * z2;
  const x2 = up[0] * z1 - up[1] * z0;
  len = 1 / Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
  const xn0 = x0 * len, xn1 = x1 * len, xn2 = x2 * len;

  const y0 = z1 * xn2 - z2 * xn1;
  const y1 = z2 * xn0 - z0 * xn2;
  const y2 = z0 * xn1 - z1 * xn0;

  return new Float32Array([
    xn0, y0, z0, 0,
    xn1, y1, z1, 0,
    xn2, y2, z2, 0,
    -(xn0 * eye[0] + xn1 * eye[1] + xn2 * eye[2]),
    -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]),
    -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]),
    1,
  ]);
}

function multiplyMatrices(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[i * 4 + j] =
        a[i * 4 + 0] * b[0 * 4 + j] +
        a[i * 4 + 1] * b[1 * 4 + j] +
        a[i * 4 + 2] * b[2 * 4 + j] +
        a[i * 4 + 3] * b[3 * 4 + j];
    }
  }
  return out;
}
