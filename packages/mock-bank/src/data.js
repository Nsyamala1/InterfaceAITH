// In-memory member data for the mock "Meridian Credit Union — Teller Console".
// Deliberately includes members that exercise the runtime conditions replay must handle:
// not-found, permission-denied, slow-load, and session-expiry-on-access.

const members = [
  {
    id: "12345",
    firstName: "John",
    lastName: "Castillo",
    savings: 8452.13,
    checking: 2100.44,
    flags: {},
  },
  {
    id: "20000",
    firstName: "Priya",
    lastName: "Shah",
    savings: 530.0,
    checking: 75.2,
    flags: {},
  },
  {
    id: "30500",
    firstName: "Derek",
    lastName: "Owusu",
    savings: 15200.9,
    checking: 4400.0,
    flags: {},
  },
  {
    id: "90001",
    firstName: "Restricted",
    lastName: "Account",
    savings: 0,
    checking: 0,
    flags: { permissionRestricted: true },
  },
  {
    id: "77777",
    firstName: "Slow",
    lastName: "Loader",
    savings: 100.0,
    checking: 50.0,
    flags: { slowLoad: true },
  },
  {
    id: "66666",
    firstName: "Session",
    lastName: "Trap",
    savings: 200.0,
    checking: 20.0,
    flags: { expireSessionOnView: true },
  },
];

let subAccountSeq = 1000;

function findMember(id) {
  return members.find((m) => m.id === id);
}

function nextConfirmationNumber() {
  subAccountSeq += 1;
  return `SA-${subAccountSeq}`;
}

module.exports = { members, findMember, nextConfirmationNumber };
