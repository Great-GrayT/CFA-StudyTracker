"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { TopicCoverage } from "@/lib/coverage";
import styles from "./massif.module.css";

// The massif: each topic a stack of discs, one disc per reading.
//
// Opt-in, never the hero. The hero is the sorted weight-gap list, because
// position on a common scale decodes more accurately than area plus height,
// and a canvas cannot be focused, labelled, or read aloud.
//
// Discrete treads rather than a smooth extrusion: a countable stack says "nine
// of fourteen readings" where a smooth column only says "about two thirds".
//
// Every disc across every topic is ONE InstancedMesh. Sixty instanced
// cylinders are one draw call; sixty separate meshes are sixty.

type Props = {
  topics: TopicCoverage[];
  readingCounts: Map<string, number>;
  onSelect?: (topicId: string) => void;
};

const DISC_HEIGHT = 0.18;
const DISC_GAP = 0.04;

type Disc = {
  topicId: string;
  x: number;
  z: number;
  y: number;
  radius: number;
  covered: boolean;
};

function layout(topics: TopicCoverage[], readingCounts: Map<string, number>): Disc[] {
  const discs: Disc[] = [];
  // Grid placement rather than a packing algorithm: with ten topics a tidy
  // grid reads better than an optimal but irregular arrangement.
  const cols = Math.ceil(Math.sqrt(Math.max(1, topics.length)));
  topics.forEach((t, i) => {
    const readings = Math.max(1, readingCounts.get(t.topicId) ?? 1);
    const coveredFraction = t.total === 0 ? 0 : t.covered / t.total;
    const coveredDiscs = Math.round(readings * coveredFraction);
    // Footprint area is the exam weight midpoint, so radius is its square root:
    // encoding weight on the radius directly would exaggerate it by squaring.
    const midpoint = (t.weightMin + t.weightMax) / 2;
    const radius = Math.sqrt(midpoint) * 0.22;
    const col = i % cols;
    const row = Math.floor(i / cols);
    for (let d = 0; d < readings; d++) {
      discs.push({
        topicId: t.topicId,
        x: (col - (cols - 1) / 2) * 2.6,
        z: (row - (cols - 1) / 2) * 2.6,
        y: d * (DISC_HEIGHT + DISC_GAP) + DISC_HEIGHT / 2,
        radius,
        covered: d < coveredDiscs,
      });
    }
  });
  return discs;
}

function Stacks({ discs, onSelect }: { discs: Disc[]; onSelect?: (id: string) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const brass = useMemo(() => new THREE.Color("#C8A24A"), []);
  const untouched = useMemo(() => new THREE.Color("#2C4149"), []);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    discs.forEach((d, i) => {
      dummy.position.set(d.x, d.y, d.z);
      dummy.scale.set(d.radius, 1, d.radius);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, d.covered ? brass : untouched);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [discs, brass, untouched]);

  // One slow rotation gives the depth cue that a static isometric render
  // cannot. It stops entirely under reduced motion.
  const reduced = useRef(false);
  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
  useFrame((_, delta) => {
    if (ref.current && !reduced.current) ref.current.rotation.y += delta * 0.08;
  });

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, discs.length]}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => setHovered(e.instanceId ?? null)}
      onPointerOut={() => setHovered(null)}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        const id = e.instanceId;
        if (id != null && onSelect) onSelect(discs[id].topicId);
      }}
    >
      <cylinderGeometry args={[1, 1, DISC_HEIGHT, 24]} />
      <meshStandardMaterial roughness={0.75} metalness={0.05} />
      {hovered !== null && null}
    </instancedMesh>
  );
}

export function Massif({ topics, readingCounts, onSelect }: Props) {
  const [failed, setFailed] = useState(false);
  const discs = useMemo(() => layout(topics, readingCounts), [topics, readingCounts]);

  // Android Chrome reclaims WebGL contexts in installed PWAs. Without this the
  // user comes back to a blank rectangle with no explanation.
  function onCreated({ gl }: { gl: THREE.WebGLRenderer }) {
    gl.domElement.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      setFailed(true);
    });
  }

  if (failed) {
    return (
      <p className={styles.lost} role="status">
        The 3D view stopped. Showing the chart instead.
      </p>
    );
  }

  return (
    <div className={styles.wrap}>
      <Canvas
        camera={{ position: [7, 6, 7], fov: 40 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "low-power" }}
        onCreated={onCreated}
        // The canvas is decorative here: the same data is a table one tap
        // away, so a screen reader is pointed there rather than at a mesh.
        aria-hidden="true"
      >
        <color attach="background" args={["#0F1A1E"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 3]} intensity={1.1} />
        <Stacks discs={discs} onSelect={onSelect} />
        <OrbitControls enablePan={false} minDistance={5} maxDistance={16} maxPolarAngle={Math.PI / 2.1} />
      </Canvas>
    </div>
  );
}
