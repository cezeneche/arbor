import { NextResponse } from 'next/server'

export const ok = <T>(data: T, status = 200) => NextResponse.json(data, { status })
export const err = (message: string, code: string, status: number) =>
  NextResponse.json({ error: message, code }, { status })
