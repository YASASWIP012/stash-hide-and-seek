import type { Container, RoomManifest } from './types.ts';

const f = (n: number) => Number(n.toFixed(4)).toString();
const v = (a: readonly number[]) => a.map(f).join(' ');
const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Export the room as URDF: a fixed base link, one fixed body per container and one moving
 * part per container joined by the joint Lux3D articulation produced (or an estimate, flagged).
 * Collision geometry is the container box. URDF is Z-up, so Y-up coordinates are rotated.
 */
export function roomToUrdf(room: RoomManifest): string {
  const toZup = ([x, y, z]: readonly number[]) => [x ?? 0, -(z ?? 0), y ?? 0];
  const lines: string[] = [];
  lines.push('<?xml version="1.0"?>');
  lines.push(`<robot name="${esc(room.id)}">`);
  lines.push(`  <!-- ${esc(room.title)}. Joint limits marked "estimate" were not measured. -->`);
  lines.push('  <link name="room_base"/>');

  for (const c of room.containers) lines.push(...containerXml(c, toZup));

  lines.push('</robot>');
  return lines.join('\n');
}

function containerXml(c: Container, toZup: (a: readonly number[]) => number[]): string[] {
  const id = c.id.replace(/[^a-zA-Z0-9_]/g, '_');
  const [w, h, d] = c.box.size;
  const size = v([w, d, h]);
  const center = v(toZup(c.box.center));
  const origin = v(toZup(c.joint.origin));
  const axis = v(toZup(c.joint.axis));
  // The part link's frame is the joint frame, so geometry is placed relative to the joint origin.
  const zc = toZup(c.box.center), zo = toZup(c.joint.origin);
  const offset = v([zc[0]! - zo[0]!, zc[1]! - zo[1]!, zc[2]! - zo[2]!]);
  const boxGeom = `<origin xyz="${offset}" rpy="0 0 0"/><geometry><box size="${size}"/></geometry>`;
  // Lux3D part meshes are authored in the joint frame, Y-up; roll +90 degrees turns them Z-up.
  const visual = c.mesh ? `<origin xyz="0 0 0" rpy="1.5708 0 0"/><geometry><mesh filename="${esc(c.mesh)}"/></geometry>` : boxGeom;
  return [
    `  <link name="${id}_body">`,
    `    <collision><geometry><box size="${size}"/></geometry></collision>`,
    '  </link>',
    `  <joint name="${id}_mount" type="fixed">`,
    '    <parent link="room_base"/>',
    `    <child link="${id}_body"/>`,
    `    <origin xyz="${center}" rpy="0 0 ${f(c.box.yaw)}"/>`,
    '  </joint>',
    `  <link name="${id}_part">`,
    `    <visual>${visual}</visual>`,
    `    <collision>${boxGeom}</collision>`,
    '  </link>',
    `  <!-- ${esc(c.label)}: limits from ${c.joint.source}${c.joint.measured !== undefined ? `, tape-measured travel ${f(c.joint.measured)}` : ''} -->`,
    `  <joint name="${id}_joint" type="${c.joint.type}">`,
    `    <parent link="room_base"/>`,
    `    <child link="${id}_part"/>`,
    `    <origin xyz="${origin}" rpy="0 0 ${f(c.box.yaw)}"/>`,
    `    <axis xyz="${axis}"/>`,
    `    <limit lower="${f(c.joint.lower)}" upper="${f(c.joint.upper)}" effort="20" velocity="1"/>`,
    '  </joint>',
    // Parts that open together with the main one (a wardrobe's second door) follow it as mimic joints.
    ...(c.extraParts ?? []).flatMap((x, k) => {
      const name = `${id}_part${k + 2}`;
      const ratio = c.joint.upper !== 0 ? x.joint.upper / c.joint.upper : 1;
      return [
        `  <link name="${name}">`,
        `    <visual><origin xyz="0 0 0" rpy="1.5708 0 0"/><geometry><mesh filename="${esc(x.mesh)}"/></geometry></visual>`,
        '  </link>',
        `  <!-- ${esc(c.label)}, part ${k + 2}: limits from ${x.joint.source}; opens with ${id}_joint -->`,
        `  <joint name="${name}_joint" type="${x.joint.type}">`,
        '    <parent link="room_base"/>',
        `    <child link="${name}"/>`,
        `    <origin xyz="${v(toZup(x.joint.origin))}" rpy="0 0 ${f(c.box.yaw)}"/>`,
        `    <axis xyz="${v(toZup(x.joint.axis))}"/>`,
        `    <limit lower="${f(x.joint.lower)}" upper="${f(x.joint.upper)}" effort="20" velocity="1"/>`,
        `    <mimic joint="${id}_joint" multiplier="${f(ratio)}" offset="0"/>`,
        '  </joint>',
      ];
    }),
  ];
}
