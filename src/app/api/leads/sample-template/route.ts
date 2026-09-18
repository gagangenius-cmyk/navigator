import { NextResponse } from 'next/server';
import { jsonToSheetBuffer } from '@/lib/excelCompat';

export async function GET() {
  const excelBuffer = await jsonToSheetBuffer([
    {
      Name: 'John Doe',
      'Contact Number': '971500000000',
      'Email Address': 'john.doe@example.com',
      'Destination Country': 'Canada',
      Remarks: 'Interested in Express Entry, prefers evening calls',
    },
  ], 'Leads');

  // Buffer<ArrayBufferLike>/Uint8Array<ArrayBufferLike> no longer structurally
  // satisfy BodyInit under this project's current @types/node + TS lib.dom
  // (ArrayBufferView<ArrayBuffer> now requires a non-shared backing buffer) -
  // a confirmed, ecosystem-wide typing gap, not a real runtime concern.
  return new NextResponse(excelBuffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="leads-sample-template.xlsx"',
    },
  });
}
