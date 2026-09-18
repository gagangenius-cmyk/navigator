import { NextResponse } from 'next/server';
import { jsonToSheetBuffer } from '@/lib/excelCompat';

export async function GET() {
  const excelBuffer = await jsonToSheetBuffer([
    {
      Name: 'John Doe',
      Email: 'john.doe@example.com',
      'Company Email': 'john.doe@dm-consultants.com',
      Mobile: '971500000000',
      'Company Mobile': '971500000001',
      Username: 'john.doe',
      Password: 'ChangeMe@123',
      'Employee ID': 'EMP001',
      Department: 'Sales',
      'Role ID': '',
      'Branch ID': '',
      'Region ID': '',
      Status: 'Active',
      'Date of Birth': '1990-01-15',
      'Date of Joining': '2026-08-01',
      Nationality: 'UAE',
      Gender: 'Male',
      'Passport No': 'P1234567',
      'Visa Expiry': '2028-08-01',
      Address: 'Dubai, UAE',
      'Work Location': 'Onshore',
      'Work Country': 'UAE',
      'Work City': 'Dubai',
      'Work Site': 'Head Office',
      'Employment Type': 'Full-time',
    },
  ], 'Employees');

  // Buffer<ArrayBufferLike>/Uint8Array<ArrayBufferLike> no longer structurally
  // satisfy BodyInit under this project's current @types/node + TS lib.dom
  // (ArrayBufferView<ArrayBuffer> now requires a non-shared backing buffer) -
  // a confirmed, ecosystem-wide typing gap, not a real runtime concern.
  return new NextResponse(excelBuffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="employee-sample-template.xlsx"',
    },
  });
}
