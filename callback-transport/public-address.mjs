import { BlockList, isIP } from 'node:net';

// Conservative snapshot of IANA special-purpose registries, reviewed 2026-11-15.
// Deny special-purpose assignments even where a narrower exception is global.
// IPv6 must also be native global unicast; mapped/translated/tunneled forms fail.
// See README.md for sources and the review requirement when registries change.
const denied = new BlockList();
for (const cidr of [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
  '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24',
  '192.31.196.0/24', '192.52.193.0/24', '192.88.99.0/24', '192.168.0.0/16',
  '192.175.48.0/24', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24',
  '224.0.0.0/4', '240.0.0.0/4',
  '2001::/23', '2001:db8::/32', '2002::/16', '2620:4f:8000::/48', '3fff::/20',
]) {
  const [address, prefix] = cidr.split('/');
  denied.addSubnet(address, Number(prefix), isIP(address) === 4 ? 'ipv4' : 'ipv6');
}
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

export function isPublicAddress(address) {
  if (typeof address !== 'string' || address.includes('%')) return false;
  const family = isIP(address);
  if (!family) return false;
  const type = family === 4 ? 'ipv4' : 'ipv6';
  return (family === 4 || globalV6.check(address, type)) && !denied.check(address, type);
}

export function sameAddress(a, b) {
  if (!isIP(a) || !isIP(b)) return false;
  const exact = new BlockList();
  exact.addAddress(a, isIP(a) === 4 ? 'ipv4' : 'ipv6');
  return exact.check(b, isIP(b) === 4 ? 'ipv4' : 'ipv6');
}
