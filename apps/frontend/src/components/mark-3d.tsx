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

// The full arm, all three stripes, taken verbatim from
// docs/design/assets/vortex-mark.svg so the 3D mark and the flat one are the
// same geometry. An earlier version used only the first subpath, which
// rendered a single sliver instead of a tapered arm.
const ARM_PATH =
  "M36.4 26.5 38.6 27.1 40.6 28.1 42.3 29.6 43.7 31.4 44.9 33.4 45.7 35.6 46.2 37.8 46.4 40.1 46.3 42.4 45.9 44.7 45.3 47.0 44.5 49.2 43.4 51.2 42.2 53.2 40.8 55.1 39.3 56.9 37.6 58.5 36.1 59.7 30.6 59.7 31.6 59.1 33.3 57.9 35.0 56.6 36.6 55.1 38.0 53.6 39.4 51.9 40.6 50.1 41.6 48.2 42.5 46.2 43.1 44.2 43.5 42.0 43.7 39.9 43.6 37.7 43.2 35.6 42.5 33.5 41.4 31.6 40.0 29.9 38.2 28.6ZM38.9 30.6 40.2 32.5 41.0 34.6 41.4 36.8 41.4 39.1 40.9 41.4 40.2 43.5 39.1 45.6 37.8 47.5 36.2 49.2 34.4 50.7 32.5 52.0 30.5 53.2 28.4 54.1 26.1 54.8 23.8 55.4 21.5 55.7 19.2 55.9 16.8 55.9 14.4 55.7 13.6 55.5 11.6 52.0 12.1 52.1 14.2 52.5 16.3 52.7 18.5 52.7 20.6 52.6 22.7 52.4 24.8 52.0 26.9 51.4 28.9 50.6 30.8 49.6 32.7 48.5 34.4 47.1 35.9 45.6 37.2 43.8 38.3 41.9 39.0 39.9 39.4 37.7 39.4 35.5 38.9 33.4ZM38.2 35.4 38.0 37.6 37.3 39.8 36.1 41.8 34.6 43.5 32.8 44.9 30.8 46.1 28.7 46.9 26.4 47.5 24.1 47.8 21.8 47.9 19.5 47.7 17.2 47.2 15.0 46.5 12.8 45.7 10.7 44.6 8.7 43.4 6.8 42.0 5.0 40.5 4.7 40.2 0.3 32.5 0.3 31.5 0.9 30.4 1.4 31.2 2.5 32.9 3.8 34.6 5.2 36.2 6.7 37.7 8.3 39.1 10.0 40.4 11.8 41.6 13.7 42.6 15.6 43.5 17.6 44.2 19.7 44.7 21.9 45.0 24.1 45.1 26.2 44.9 28.4 44.4 30.4 43.7 32.3 42.6 34.0 41.2 35.4 39.5 36.4 37.5Z";

/** One extruded stripe, in the XY plane, extruded along Z. */
function stripeGeometry(subpath: string): THREE.ExtrudeGeometry {
  const nums = subpath.replace(/Z\s*$/, "").trim().split(/\s+/).map(Number);
  const shape = new THREE.Shape();
  // viewBox is 0 0 64 64, so centre is 32,32. Y is flipped because SVG counts
  // downward and three counts up.
  const nx = (x: number) => (x - 32) / 32;
  const ny = (y: number) => (32 - y) / 32;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nx(nums[i]);
    const y = ny(nums[i + 1]);
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.12,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.015,
    bevelSegments: 2,
  });
}

function armGeometries(): THREE.ExtrudeGeometry[] {
  return ARM_PATH.split("M")
    .filter((x) => x.trim())
    .map(stripeGeometry);
}

function ArmInstance() {
  const geometries = useMemo(() => armGeometries(), []);
  return (
    <>
      {geometries.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial color="#4476FF" metalness={0.12} roughness={0.42} />
        </mesh>
      ))}
    </>
  );
}

function Rig({
  interactive,
  prefersReducedMotion,
  target,
  children,
}: {
  interactive?: boolean;
  prefersReducedMotion: boolean;
  target: React.RefObject<{ x: number; z: number }>;
  children: React.ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const g = groupRef.current;
    if (!g) return;
    if (prefersReducedMotion) {
      // A fixed, attractive angle. Stopped entirely, not merely slowed.
      g.rotation.x = 0.42;
      g.rotation.z = 0.35;
      return;
    }
    // The mark turns about its OWN normal, which is what a vortex does.
    // Spinning it about Y instead tips a flat rosette edge-on twice per
    // revolution and reads as a flickering blob.
    const t = clock.getElapsedTime();
    g.rotation.z = t * 0.18;
    // A fixed tilt is what makes the extrusion and bevel visible at all; with
    // the face square to the camera it may as well be the flat mark.
    g.rotation.x = 0.42;
    g.rotation.y = 0;
    g.scale.setScalar(1 + Math.sin(t * 0.6) * 0.03);

    if (interactive && target.current) {
      const damp = 0.08;
      g.rotation.x += (target.current.x - g.rotation.x) * damp;
      g.rotation.y += (target.current.z - g.rotation.y) * damp;
    }
  });

  return <group ref={groupRef}>{children}</group>;
}

function Vortex3D({ interactive, size = 64 }: Omit<Props, "className">) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const targetRotationRef = useRef({ x: 0, z: 0 });
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    setPrefersReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

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
        gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
        onCreated={onCreated}
        aria-hidden="true"
        style={{ position: "absolute", width: "100%", height: "100%" }}
      >
        <ambientLight intensity={1.5} />
        <directionalLight position={[1.2, 1.5, 2.0]} intensity={2.2} />
        {/* A second, dimmer light from the other side keeps the arms that
            turn away from the key light from going flat black. */}
        <directionalLight position={[-1.5, -0.8, 1.2]} intensity={0.8} />

        <Rig
          interactive={interactive}
          prefersReducedMotion={prefersReducedMotion}
          target={targetRotationRef}
        >
          {[0, 60, 120, 180, 240, 300].map((angle) => (
            <group key={angle} rotation={[0, 0, THREE.MathUtils.degToRad(angle)]}>
              <ArmInstance />
            </group>
          ))}
        </Rig>
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
