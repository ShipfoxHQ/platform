import {lookup} from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const METADATA_ADDRESS = '169.254.169.254';
const TRAILING_DOT_PATTERN = /\.$/;

export type EgressDeniedReason =
  | 'invalid-scheme'
  | 'host-denylist'
  | 'internal-host'
  | 'metadata-address'
  | 'private-network';

export interface EgressPolicy {
  allowPrivateNetworks: boolean;
  hostDenylist?: readonly string[] | undefined;
}

export class EgressDeniedError extends Error {
  constructor(
    public readonly reason: EgressDeniedReason,
    public readonly target: string,
  ) {
    super(`Egress denied for ${target}: ${reason}`);
    this.name = 'EgressDeniedError';
  }
}

type ParsedAddress = ipaddr.IPv4 | ipaddr.IPv6;

type DenylistEntry =
  | {kind: 'host'; host: string}
  | {kind: 'suffix'; suffix: string}
  | {kind: 'ip'; address: ParsedAddress}
  | {kind: 'cidr'; range: [ParsedAddress, number]};

export async function assertEgressAllowed(url: string, policy: EgressPolicy): Promise<void> {
  const parsed = new URL(url);
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new EgressDeniedError('invalid-scheme', parsed.protocol);
  }

  const hostname = normalizeHostname(parsed.hostname);
  const hostAddress = parseIpAddress(hostname);
  const addresses = hostAddress ? [hostAddress] : await resolveHostname(hostname);
  const denylist = parseDenylist(policy.hostDenylist ?? []);

  assertNotDenylisted(hostname, addresses, denylist);

  if (policy.allowPrivateNetworks) return;
  if (hostname.endsWith('.internal')) throw new EgressDeniedError('internal-host', hostname);

  for (const address of addresses) {
    assertPublicAddress(address);
  }
}

export function parseEgressHostDenylist(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeHostname(hostname: string): string {
  return stripIpv6Brackets(hostname).toLowerCase().replace(TRAILING_DOT_PATTERN, '');
}

function stripIpv6Brackets(value: string): string {
  if (!value.startsWith('[') || !value.endsWith(']')) return value;
  return value.slice(1, -1);
}

async function resolveHostname(hostname: string): Promise<ParsedAddress[]> {
  const records = await lookup(hostname, {all: true});
  return records.map((record) => parseIpAddress(record.address)).filter(isParsedAddress);
}

function parseIpAddress(value: string): ParsedAddress | undefined {
  if (!ipaddr.isValid(value)) return undefined;
  const address = ipaddr.parse(value);
  if (isIpv6Address(address)) {
    return normalizeIpv6Address(address);
  }
  return address;
}

function isParsedAddress(address: ParsedAddress | undefined): address is ParsedAddress {
  return address !== undefined;
}

function assertNotDenylisted(
  hostname: string,
  addresses: ParsedAddress[],
  denylist: DenylistEntry[],
): void {
  for (const entry of denylist) {
    assertHostnameNotDenylisted(hostname, entry);
    for (const address of addresses) assertAddressNotDenylisted(address, entry);
  }
}

function assertHostnameNotDenylisted(hostname: string, entry: DenylistEntry): void {
  if (entry.kind === 'host' && hostname === entry.host) {
    throw new EgressDeniedError('host-denylist', hostname);
  }
  if (entry.kind === 'suffix' && hostname.endsWith(entry.suffix)) {
    throw new EgressDeniedError('host-denylist', hostname);
  }
}

function assertAddressNotDenylisted(address: ParsedAddress, entry: DenylistEntry): void {
  if (entry.kind === 'ip' && address.toNormalizedString() === entry.address.toNormalizedString()) {
    throw new EgressDeniedError('host-denylist', address.toString());
  }
  if (entry.kind === 'cidr' && addressMatchesRange(address, entry.range)) {
    throw new EgressDeniedError('host-denylist', address.toString());
  }
}

function parseDenylist(entries: readonly string[]): DenylistEntry[] {
  return entries.map(parseDenylistEntry).filter(isDenylistEntry);
}

function parseDenylistEntry(entry: string): DenylistEntry | undefined {
  const normalized = normalizeHostname(entry.trim());
  if (!normalized) return undefined;

  const range = parseCidrRange(normalized);
  if (range) return {kind: 'cidr', range};
  if (normalized.includes('/')) throw new EgressDeniedError('host-denylist', normalized);

  const address = parseIpAddress(normalized);
  if (address) return {kind: 'ip', address};

  if (normalized.startsWith('*.')) return {kind: 'suffix', suffix: normalized.slice(1)};
  if (normalized.startsWith('.')) return {kind: 'suffix', suffix: normalized};

  return {kind: 'host', host: normalized};
}

function parseCidrRange(value: string): [ParsedAddress, number] | undefined {
  try {
    const [address, prefix] = ipaddr.parseCIDR(value);
    const normalizedAddress = isIpv6Address(address) ? normalizeIpv6Address(address) : address;
    return [normalizedAddress, prefix];
  } catch {
    return undefined;
  }
}

function isIpv6Address(address: ParsedAddress): address is ipaddr.IPv6 {
  return address.kind() === 'ipv6';
}

function normalizeIpv6Address(address: ipaddr.IPv6): ParsedAddress {
  if (address.isIPv4MappedAddress()) return address.toIPv4Address();
  return address;
}

function isDenylistEntry(entry: DenylistEntry | undefined): entry is DenylistEntry {
  return entry !== undefined;
}

function addressMatchesRange(address: ParsedAddress, range: [ParsedAddress, number]): boolean {
  const [rangeAddress, prefix] = range;
  if (address.kind() !== rangeAddress.kind()) return false;
  return address.match(rangeAddress, prefix);
}

function assertPublicAddress(address: ParsedAddress): void {
  if (address.kind() === 'ipv4' && address.toString() === METADATA_ADDRESS) {
    throw new EgressDeniedError('metadata-address', address.toString());
  }

  if (!isPublicUnicastAddress(address)) {
    throw new EgressDeniedError('private-network', address.toString());
  }
}

function isPublicUnicastAddress(address: ParsedAddress): boolean {
  return address.range() === 'unicast';
}
