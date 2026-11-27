import * as THREE from 'three';
import {Line2} from 'three/addons/lines/Line2.js';
import {LineGeometry} from 'three/addons/lines/LineGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {FLOOR_HEIGHT} from './building.js';

// Transparent foreground passes draw after the carpet, glazing and furniture.
// Screen-space width stays readable in both Shoulder and distant Top-down views.
export class NavigationOverlay extends THREE.Group {
  constructor() {
    super();
    this.version = -1;
    this.geometry = new LineGeometry();
    const line = (color, width, order) => {
      const material = new LineMaterial({color, linewidth: width, transparent: true,
        depthTest: false, depthWrite: false, toneMapped: false});
      const mesh = new Line2(this.geometry, material);
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.add(mesh);
      return mesh;
    };
    this.outline = line('#ffffff', 6, 10000);
    this.route = line('#0071e3', 3, 10001);
    this.destination = new THREE.Mesh(new THREE.RingGeometry(.15, .23, 32),
      new THREE.MeshBasicMaterial({color: '#0071e3', transparent: true,
        depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide}));
    this.destination.renderOrder = 10002;
    this.destination.visible = false;
    this.add(this.destination);
  }

  update(navigation) {
    if (!navigation || navigation.version === this.version) return false;
    this.version = navigation.version;
    this.route.visible = this.outline.visible = navigation.path.length > 1;
    if (this.route.visible) {
      this.geometry.dispose();
      this.geometry = new LineGeometry();
      this.geometry.setPositions(navigation.path.flatMap(([x, y, z]) => [x, y, z + .07]));
      this.route.geometry = this.outline.geometry = this.geometry;
    }
    this.destination.visible = Boolean(navigation.goal);
    if (navigation.goal) {
      const [x, y, floor, height] = navigation.goal;
      this.destination.position.set(x, y, (height ?? floor * FLOOR_HEIGHT) + .075);
    }
    this.destination.material.color.set(navigation.status === 'arrived' ? '#30a46c'
      : navigation.status === 'blocked' ? '#d56b36' : '#0071e3');
    return true;
  }
}
