"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { Mark } from "./mark";

type Props = {
  size?: number;
  interactive?: boolean;
  className?: string;
};

function parsePathPoints(d: string): [number, number][] {
  const points: [number, number][] = [];
  const regex = /[\d.]+/g;
  const matches = d.match(regex) || [];

  for (let i = 0; i < matches.length; i += 2) {
    points.push([parseFloat(matches[i]), parseFloat(matches[i + 1])]);
  }

  return points;
}

function createArmGeometry(): THREE.BufferGeometry {
  // One arm from the large vortex mark, sampled for spiral edges
  const d =
    "M36.4 26.5 38.6 27.1 40.6 28.1 42.3 29.6 43.7 31.4 44.9 33.4 45.7 35.6 46.2 37.8 46.4 40.1 46.3 42.4 45.9 44.7 45.3 47.0 44.5 49.2 43.4 51.2 42.2 53.2 40.8 55.1 39.3 56.9 37.6 58.5 36.1 59.7 30.6 59.7 31.6 59.1 33.3 57.9 35.0 56.6 36.6 55.1 38.0 53.6 39.4 51.9 40.6 50.1 41.6 48.2 42.5 46.2 43.1 44.2 43.5 42.0 43.7 39.9 43.6 37.7 43.2 35.6 42.5 33.5 41.4 31.6 40.0 29.9 38.2 28.6";

  const points = parsePathPoints(d);

  // Closed path: outer edge then inner edge (reversed)
  const mid = Math.floor(points.length / 2);
  const outer = points.slice(0, mid);
  const inner = points.slice(mid).reverse();

  const shape = new THREE.Shape();

  // Normalize: viewBox 0 0 64 64, center at 32, 32
  const normalizeX = (x: number) => (x - 32) / 32;
  const normalizeY = (y: number) => (32 - y) / 32;

  shape.moveTo(normalizeX(outer[0][0]), normalizeY(outer[0][1]));

  for (let i = 1; i < outer.length; i++) {
    shape.lineTo(normalizeX(outer[i][0]), normalizeY(outer[i][1]));
  }

  for (let i = 0; i < inner.length; i++) {
    shape.lineTo(normalizeX(inner[i][0]), normalizeY(inner[i][1]));
  }

  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.18,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.025,
    bevelSegments: 3,
  });

  geometry.center();
  return geometry;
}

function ArmInstance() {
  const meshRef = useRef<THREE.Mesh>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    setPrefersReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useFrame(({ clock }) => {
    if (!meshRef.current || prefersReducedMotion) return;

    // Slow continuous rotation about vertical (Y) axis
    meshRef.current.rotation.y = clock.getElapsedTime() * 0.25;

    // Gentle breathing: oscillate the depth via scale.z
    const breathe = Math.sin(clock.getElapsedTime() * 0.6) * 0.04 + 1;
    meshRef.current.scale.z = breathe;
  });

  const geometry = useMemo(() => createArmGeometry(), []);

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshStandardMaterial color="#4476FF" metalness={0.6} roughness={0.35} />
    </mesh>
  );
}

function Vortex3D({ interactive, size = 64 }: Omit<Props, "className">) {
  const groupRef = useRef<THREE.Group>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const targetRotationRef = useRef({ x: 0, z: 0 });
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    setPrefersReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useFrame(() => {
    if (!groupRef.current) return;

    if (prefersReducedMotion && !interactive) {
      // Fixed angle, no animation
      groupRef.current.rotation.x = 0.3;
      groupRef.current.rotation.z = 0.4;
    } else if (interactive && !prefersReducedMotion) {
      // Smooth damping toward pointer
      const dampFactor = 0.08;
      groupRef.current.rotation.x +=
        (targetRotationRef.current.x - groupRef.current.rotation.x) * dampFactor;
      groupRef.current.rotation.z +=
        (targetRotationRef.current.z - groupRef.current.rotation.z) * dampFactor;
    }
  });

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || prefersReducedMotion) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // Map to rotation: center is neutral, edges tilt
    targetRotationRef.current.x = (y - 0.5) * 0.4;
    targetRotationRef.current.z = (x - 0.5) * 0.4;
  };

  function onCreated({ gl }: { gl: THREE.WebGLRenderer }) {
    gl.domElement.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      setFailed(true);
    });
  }

  if (failed) {
    return <Mark size={size} />;
  }

  return (
    <div
      ref={canvasRef}
      style={{
        width: size,
        height: size,
        position: "relative",
        overflow: "hidden",
      }}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => {
        targetRotationRef.current = { x: 0, z: 0 };
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 2.2], fov: 50 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "low-power" }}
        onCreated={onCreated}
        aria-hidden="true"
        style={{ position: "absolute", width: "100%", height: "100%" }}
      >
        <color attach="background" args={["#070B26"]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[1.2, 1.5, 0.8]} intensity={1.3} />

        <group ref={groupRef}>
          {[0, 60, 120, 180, 240, 300].map((angle) => (
            <group key={angle} rotation={[0, THREE.MathUtils.degToRad(angle), 0]}>
              <ArmInstance />
            </group>
          ))}
        </group>
      </Canvas>
    </div>
  );
}

export function Mark3D({ size = 64, interactive = false, className }: Props) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Render flat mark during SSR and initial load
  if (!isClient) {
    return <Mark size={size} className={className} />;
  }

  return (
    <div className={className}>
      <Vortex3D size={size} interactive={interactive} />
    </div>
  );
}
