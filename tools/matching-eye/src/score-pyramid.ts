import * as THREE from 'three';
import {
  PYRAMID_EDGES,
  PYRAMID_FACES,
  PYRAMID_VERTICES,
  pyramidPoints,
} from './pyramid-geometry.ts';
import type { Point3 } from './pyramid-geometry.ts';

const glassVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 point = modelViewMatrix * vec4(position, 1.0);
    vView = -point.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * point;
  }
`;
const glassFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 normal = normalize(vNormal);
    vec3 view = normalize(vView);
    float rim = pow(1.0 - abs(dot(normal, view)), 2.6);
    float light = abs(dot(normal, normalize(vec3(-0.7, 1.0, 1.3))));
    float glint = pow(abs(dot(reflect(-view, normal), normalize(vec3(-0.3, 0.9, 1.0)))), 28.0);
    vec3 color = uColor * (0.54 + light * 0.44) + vec3(0.93, 0.87, 0.73) * glint * 0.22;
    gl_FragColor = vec4(color, uOpacity * (0.35 + rim * 0.65));
    #include <colorspace_fragment>
  }
`;

function geometry(points: readonly Point3[], order: readonly number[]): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry();
  result.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      order.flatMap((i) => points[i]),
      3,
    ),
  );
  result.computeVertexNormals();
  return result;
}

function glass(color: string, opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: glassVertex,
    fragmentShader: glassFragment,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

/** Four score vertices inside a stable, optically quiet glass reference volume. */
export class ScorePyramidRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 30);
  private readonly assembly = new THREE.Group();
  private readonly surface = new THREE.Mesh(
    geometry(PYRAMID_VERTICES, PYRAMID_FACES),
    glass('#c2cbbf', 0.12),
  );
  private readonly frame = new THREE.LineSegments(
    geometry(PYRAMID_VERTICES, PYRAMID_EDGES),
    new THREE.LineBasicMaterial({ color: '#c5cbbc', transparent: true, opacity: 0.55 }),
  );
  private readonly value = new THREE.Mesh(
    geometry(pyramidPoints([0, 0, 0, 0]), PYRAMID_FACES),
    glass('#deb762', 0.78),
  );
  private readonly edges = new THREE.LineSegments(
    geometry(pyramidPoints([0, 0, 0, 0]), PYRAMID_EDGES),
    new THREE.LineBasicMaterial({ color: '#ebcc8a', transparent: true, opacity: 0.96 }),
  );
  private readonly guides = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(
      PYRAMID_VERTICES.flatMap((v) => [new THREE.Vector3(), new THREE.Vector3(...v)]),
    ),
    new THREE.LineDashedMaterial({
      color: '#a6b19b',
      transparent: true,
      opacity: 0.2,
      dashSize: 0.035,
      gapSize: 0.06,
    }),
  );
  private readonly markers: THREE.Mesh[] = [];
  private readonly gold = new THREE.Color('#deb762');
  private readonly rose = new THREE.Color('#e77773');
  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor('#0b0d0b', 0);
    this.camera.position.set(0, 0.3, 5.6);
    this.camera.lookAt(0, 0.13, 0);
    this.guides.computeLineDistances();
    this.surface.renderOrder = 0;
    this.value.renderOrder = 1;
    this.frame.renderOrder = 2;
    this.edges.renderOrder = 3;
    this.assembly.add(this.surface, this.guides, this.value, this.frame, this.edges);
    for (let index = 0; index < 4; index += 1) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.022, 10, 8),
        new THREE.MeshBasicMaterial({ color: '#fff0ca' }),
      );
      this.markers.push(marker);
      this.assembly.add(marker);
    }
    this.scene.add(this.assembly);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  render(
    scores: readonly number[],
    colorMix: number,
    yaw: number,
    pitch: number,
    zoom: number,
  ): { x: number; y: number; depth: number }[] {
    const points = pyramidPoints(scores);
    for (const [object, order] of [
      [this.value, PYRAMID_FACES],
      [this.edges, PYRAMID_EDGES],
    ] as const) {
      const attribute = object.geometry.getAttribute('position');
      order.forEach((index, vertex) => attribute.setXYZ(vertex, ...points[index]));
      attribute.needsUpdate = true;
      object.geometry.computeBoundingSphere();
    }
    this.value.geometry.computeVertexNormals();
    this.value.material.uniforms.uColor.value.copy(this.gold).lerp(this.rose, colorMix);
    this.edges.material.color.copy(this.gold).lerp(this.rose, colorMix).multiplyScalar(1.12);
    this.markers.forEach((marker, index) => marker.position.set(...points[index]));
    this.assembly.rotation.set(pitch, yaw, 0);
    this.camera.zoom = zoom;
    this.camera.updateProjectionMatrix();
    this.assembly.updateMatrixWorld(true);
    this.renderer.render(this.scene, this.camera);
    return PYRAMID_VERTICES.map((vertex) => {
      const point = new THREE.Vector3(...vertex)
        .applyMatrix4(this.assembly.matrixWorld)
        .project(this.camera);
      return {
        x: ((point.x + 1) * this.width) / 2,
        y: ((1 - point.y) * this.height) / 2,
        depth: point.z,
      };
    });
  }

  dispose(): void {
    this.assembly.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
