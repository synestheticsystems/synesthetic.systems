import { useRef, useEffect } from 'react'

import './App.css'
import styled, { createGlobalStyle } from 'styled-components'


const FontLoader = createGlobalStyle`
  @import url('https://fonts.googleapis.com/css2?family=Source+Code+Pro&display=swap');
`

const Container = styled.div`
  font-family: 'Source Code Pro', monospace;
  color: #fff;
  z-index: 100;
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
`

const Title = styled.h1`
  /* Add any specific styles for h1 */
`

const Subtitle = styled.h2`
  /* Add any specific styles for h2 */
`

function App() {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;

    const svg = ref.current;
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');

    const centerOfScreen = {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2
    };

    const radius = Math.min(window.innerWidth, window.innerHeight) * 0.9;
    // animate the rotation
    let rotation = 0;
    // needs to be cancelable


    let animationFrameId = requestAnimationFrame(function animate() {
      // cancelable
      rotation += .03;

      // Clear the svg
      svg.innerHTML = '';
      tesselateTriangle(svg, centerOfScreen, radius, 10, '#222222', '#2222FF', rotation, -2, 1);
      animationFrameId = requestAnimationFrame(animate);
    });
    return () => cancelAnimationFrame(animationFrameId);
  }, []);
  return (
    <>
      <FontLoader />
      <svg ref={ref} style={{ zIndex: 1, position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: '#141414' }}></svg>
      <Container>
        <Title>Synesthetic Systems</Title>
        <Subtitle>Taste the future</Subtitle>
      </Container>
    </>
  )
}

export default App

type Point = {
  x: number;
  y: number;
}

function tesselateTriangle(svgElement: SVGSVGElement, center: Point, radius: number, sides: number, color1: string, color2: string, rotation: number, innerRotationMultiplier: number, recurseLevels: number) {
  // Convert hex colors to RGB
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);

  const sideLength = radius * Math.sqrt(3);
  const smallSideLength = sideLength / sides;
  const smallHeight = (smallSideLength * Math.sqrt(3)) / 2;
  const smallRadius = smallSideLength / Math.sqrt(3);

  // Calculate the corners of the large triangle
  const topCorner = rotatePoint({ x: center.x, y: center.y - radius }, center, rotation);
  const bottomLeftCorner = rotatePoint({ x: center.x - sideLength / 2, y: center.y + radius / 2 }, center, rotation);
  const bottomRightCorner = rotatePoint({ x: center.x + sideLength / 2, y: center.y + radius / 2 }, center, rotation);

  for (let row = 0; row < sides; row++) {
    const unrotatedCenterY = center.y - radius + (smallHeight * (row)) + smallRadius;
    const uprightTrianglesInRow = row + 1;
    const upsideDownTrianglesInRow = row;

    // right side up triangle tiling
    for (let col = 0; col < uprightTrianglesInRow; col++) {
      const unrotatedCenterX = center.x - (sideLength / 2) + (col * smallSideLength) + ((sides - row - 1) * smallSideLength / 2) + (smallSideLength / 2);
      const rotatedCenter = rotatePoint({ x: unrotatedCenterX, y: unrotatedCenterY }, center, rotation);
      const t = calculateGradientFactor(rotatedCenter, topCorner, bottomLeftCorner, bottomRightCorner);
      const color = interpolateColor(rgb1, rgb2, t);
      if (recurseLevels > 0) {
        // interpolate the color from one side of the triangle to the other
        const innerColor1 = interpolateColor(rgb1, rgb2, t);
        const innerColor2 = interpolateColor(rgb1, rgb2, 1 - t);
        // tesselate the triangle
        tesselateTriangle(svgElement, rotatedCenter, smallRadius, sides, rgbToHex(innerColor1), rgbToHex(innerColor2), rotation * innerRotationMultiplier * 2, innerRotationMultiplier, recurseLevels - 1);
      } else {
        drawEquilateralTriangle(svgElement, rotatedCenter, smallRadius, rotation * innerRotationMultiplier * 2, rgbToHex(color));
      }
    }

    // upside down triangle tiling
    if (row > 0 && row < sides) {
      const unrotatedCenterY = center.y - radius + (smallHeight * (row)) + smallHeight - smallRadius;
      for (let col = 0; col < upsideDownTrianglesInRow; col++) {
        const unrotatedCenterX = center.x - (sideLength / 2) + (col * smallSideLength) + ((sides - row - 1) * smallSideLength / 2) + (smallSideLength);
        const rotatedCenter = rotatePoint({ x: unrotatedCenterX, y: unrotatedCenterY }, center, rotation);
        const t = calculateGradientFactor(rotatedCenter, topCorner, bottomLeftCorner, bottomRightCorner);
        const color = interpolateColor(rgb1, rgb2, t);

        const innerRotation = rotation * innerRotationMultiplier * 2 + 180;
        if (recurseLevels > 0) {
          // interpolate the color from one side of the triangle to the other
          const innerColor1 = interpolateColor(rgb1, rgb2, t);
          const innerColor2 = interpolateColor(rgb1, rgb2, 1 - t);
          // tesselate the triangle
          tesselateTriangle(svgElement, rotatedCenter, smallRadius, sides, rgbToHex(innerColor1), rgbToHex(innerColor2), innerRotation, innerRotationMultiplier, recurseLevels - 1);
          tesselateTriangle(svgElement, rotatedCenter, smallRadius, sides, rgbToHex(color), rgbToHex(color), innerRotation, innerRotationMultiplier, recurseLevels - 1);
        } else {
          drawEquilateralTriangle(svgElement, rotatedCenter, smallRadius, innerRotation, rgbToHex(color));
        }
      }
    }
  }
}

// New helper function to calculate the gradient factor
function calculateGradientFactor(point: Point, corner1: Point, corner2: Point, corner3: Point): number {
  // Calculate vectors
  const v1 = { x: corner2.x - corner1.x, y: corner2.y - corner1.y };
  const v2 = { x: corner3.x - corner1.x, y: corner3.y - corner1.y };
  const vp = { x: point.x - corner1.x, y: point.y - corner1.y };

  // Calculate dot products
  const dot11 = v1.x * v1.x + v1.y * v1.y;
  const dot12 = v1.x * v2.x + v1.y * v2.y;
  const dot1p = v1.x * vp.x + v1.y * vp.y;
  const dot22 = v2.x * v2.x + v2.y * v2.y;
  const dot2p = v2.x * vp.x + v2.y * vp.y;

  // Calculate barycentric coordinates
  const invDenom = 1 / (dot11 * dot22 - dot12 * dot12);
  // const u = (dot22 * dot1p - dot12 * dot2p) * invDenom;
  const v = (dot11 * dot2p - dot12 * dot1p) * invDenom;

  // Use the v coordinate (ranges from 0 to 1) as our gradient factor
  return v;
}

// Helper function to convert hex to RGB
function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

// Helper function to interpolate between two RGB colors
function interpolateColor(color1: [number, number, number], color2: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(color1[0] * (1 - t) + color2[0] * t),
    Math.round(color1[1] * (1 - t) + color2[1] * t),
    Math.round(color1[2] * (1 - t) + color2[2] * t)
  ];
}

// Helper function to convert RGB to hex
function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map(x => x.toString(16).padStart(2, '0')).join('');
}

function drawEquilateralTriangle(svg: SVGSVGElement, center: Point, radius: number, rotation: number, fill: string) {
  const points: Point[] = [];
  for (let i = 0; i < 3; i++) {
    const angle = (i * 120 + rotation) * (Math.PI / 180);
    points.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle)
    });
  }

  const triangle = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  triangle.setAttribute('points', points.map(p => `${p.x},${p.y}`).join(' '));
  triangle.setAttribute('fill', fill);
  svg.appendChild(triangle);
}

// Add this new helper function to rotate a point around a center
function rotatePoint(point: Point, center: Point, angleDegrees: number): Point {
  const angleRadians = angleDegrees * Math.PI / 180;
  const cos = Math.cos(angleRadians);
  const sin = Math.sin(angleRadians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos
  };
}