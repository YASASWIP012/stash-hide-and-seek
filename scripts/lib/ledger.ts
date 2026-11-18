// Credit ledger kept in data/ledger.json (committed, no secrets). The pipeline reads the
// balance from here before every paid call. Reconcile it against labs.aholo.ai/usage by hand.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export interface LedgerEntry {
  at: string;
  kind: string;
  taskId?: string;
  credits: number; // positive = spent, negative = granted
  note?: string;
  request?: string;
}

export interface LedgerFile {
  startingBalance: number;
  entries: LedgerEntry[];
}

export interface Ledger {
  balance(): Promise<number>;
  startingBalance(): Promise<number>;
  record(e: Omit<LedgerEntry, 'at'>): Promise<void>;
}

export function balanceOf(f: LedgerFile): number {
  return f.entries.reduce((b, e) => b - e.credits, f.startingBalance);
}

export class FileLedger implements Ledger {
  readonly path: string;
  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<LedgerFile> {
    if (!existsSync(this.path)) throw new Error(`No ledger at ${this.path}. Create it with the starting balance first.`);
    return JSON.parse(await readFile(this.path, 'utf8')) as LedgerFile;
  }

  async balance() {
    return balanceOf(await this.load());
  }

  async startingBalance() {
    return (await this.load()).startingBalance;
  }

  async record(e: Omit<LedgerEntry, 'at'>) {
    const f = await this.load();
    f.entries.push({ at: new Date().toISOString(), ...e });
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(f, null, 2)}\n`);
  }
}

export class MemoryLedger implements Ledger {
  readonly file: LedgerFile;
  constructor(startingBalance: number) {
    this.file = { startingBalance, entries: [] };
  }
  async balance() {
    return balanceOf(this.file);
  }
  async startingBalance() {
    return this.file.startingBalance;
  }
  async record(e: Omit<LedgerEntry, 'at'>) {
    this.file.entries.push({ at: new Date().toISOString(), ...e });
  }
}
