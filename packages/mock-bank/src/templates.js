// Deliberately "legacy enterprise" markup: table-based layout, no test IDs,
// no semantic classes/ids on interactive elements beyond what a real form needs.
// Controls are still real <input>/<button>/<a> elements with visible text and
// <label> associations, so an accessibility-tree-based agent can still operate
// them the way a human operator would -- there just isn't a data-testid anywhere.

function page(title, bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head><title>Meridian Credit Union - Teller Console - ${title}</title></head>
<body bgcolor="#ffffff">
<table width="100%" cellpadding="4" cellspacing="0" border="0">
  <tr bgcolor="#003366">
    <td><font color="white" size="4"><b>Meridian Credit Union &mdash; Teller Console</b></font></td>
    <td align="right"><font color="white">${title}</font></td>
  </tr>
</table>
<hr>
${bodyHtml}
<hr>
<font size="1">Internal use only. Teller Console v3.2 (legacy).</font>
</body>
</html>`;
}

function loginPage(errorMsg) {
  const errBlock = errorMsg
    ? `<tr><td colspan="2"><font color="red">${errorMsg}</font></td></tr>`
    : "";
  return page(
    "Login",
    `
<table>
  <form method="POST" action="/login">
  ${errBlock}
  <tr>
    <td><label for="username">Teller ID</label></td>
    <td><input type="text" id="username" name="username" /></td>
  </tr>
  <tr>
    <td><label for="password">Password</label></td>
    <td><input type="password" id="password" name="password" /></td>
  </tr>
  <tr>
    <td colspan="2"><button type="submit">Log In</button></td>
  </tr>
  </form>
</table>`
  );
}

function searchPage(resultRowsHtml, errorMsg) {
  const errBlock = errorMsg
    ? `<p><font color="red">${errorMsg}</font></p>`
    : "";
  return page(
    "Member Search",
    `
<table>
  <form method="GET" action="/members/search">
  <tr>
    <td><label for="memberId">Member ID</label></td>
    <td><input type="text" id="memberId" name="memberId" /></td>
    <td><button type="submit">Search</button></td>
  </tr>
  </form>
</table>
${errBlock}
<table border="1" cellpadding="3">
  <tr><td><b>Member ID</b></td><td><b>Name</b></td><td><b>&nbsp;</b></td></tr>
  ${resultRowsHtml}
</table>`
  );
}

function resultRow(member) {
  return `<tr><td>${member.id}</td><td>${member.firstName} ${member.lastName}</td><td><a href="/members/${member.id}">View</a></td></tr>`;
}

function memberDetailPage(member) {
  return page(
    `Member ${member.id}`,
    `
<table>
  <tr><td><b>Member ID</b></td><td>${member.id}</td></tr>
  <tr><td><b>Name</b></td><td>${member.firstName} ${member.lastName}</td></tr>
</table>
<table border="1" cellpadding="3">
  <tr><td><b>Account</b></td><td><b>Balance</b></td></tr>
  <tr><td>Savings</td><td id="savings-balance">$${member.savings.toFixed(2)}</td></tr>
  <tr><td>Checking</td><td id="checking-balance">$${member.checking.toFixed(2)}</td></tr>
</table>
<p><a href="/members/${member.id}/sub-accounts/new">Open New Sub-Account</a></p>
<p><a href="/members/search">Back to Search</a></p>`
  );
}

function notFoundPage(memberId) {
  return page(
    "Member Not Found",
    `<p><font color="red">No member found with ID "${memberId}". Please verify the ID and try again.</font></p>
<p><a href="/members/search">Back to Search</a></p>`
  );
}

function permissionDeniedPage(memberId) {
  return page(
    "Access Denied",
    `<p><font color="red">You are not authorized to view member ${memberId}. This account is restricted.</font></p>
<p><a href="/members/search">Back to Search</a></p>`
  );
}

function newSubAccountPage(member, errorMsg) {
  const errBlock = errorMsg
    ? `<tr><td colspan="2"><font color="red">${errorMsg}</font></td></tr>`
    : "";
  return page(
    `New Sub-Account for ${member.id}`,
    `
<p>Member: ${member.firstName} ${member.lastName} (${member.id})</p>
<table>
  <form method="POST" action="/members/${member.id}/sub-accounts" onsubmit="return confirm('Confirm: open a new sub-account for this member?');">
  ${errBlock}
  <tr>
    <td><label for="accountType">Sub-Account Type</label></td>
    <td>
      <select id="accountType" name="accountType">
        <option value="savings">Savings</option>
        <option value="christmas_club">Christmas Club</option>
        <option value="youth_savings">Youth Savings</option>
      </select>
    </td>
  </tr>
  <tr>
    <td><label for="initialDeposit">Initial Deposit (USD)</label></td>
    <td><input type="text" id="initialDeposit" name="initialDeposit" /></td>
  </tr>
  <tr>
    <td colspan="2"><button type="submit">Open Sub-Account</button></td>
  </tr>
  </form>
</table>
<p><a href="/members/${member.id}">Back to Member</a></p>`
  );
}

function subAccountConfirmationPage(member, accountType, initialDeposit, confirmationNumber) {
  return page(
    "Sub-Account Confirmation",
    `
<p><b>Sub-account opened successfully.</b></p>
<table border="1" cellpadding="3">
  <tr><td>Confirmation Number</td><td id="confirmation-number">${confirmationNumber}</td></tr>
  <tr><td>Member</td><td>${member.firstName} ${member.lastName} (${member.id})</td></tr>
  <tr><td>Sub-Account Type</td><td>${accountType}</td></tr>
  <tr><td>Initial Deposit</td><td>$${initialDeposit.toFixed(2)}</td></tr>
</table>
<p><a href="/members/${member.id}">Back to Member</a></p>`
  );
}

function sessionExpiredPage() {
  return page(
    "Session Expired",
    `<p><font color="red">Your session has expired. Please log in again.</font></p>
<p><a href="/login">Log In</a></p>`
  );
}

module.exports = {
  loginPage,
  searchPage,
  resultRow,
  memberDetailPage,
  notFoundPage,
  permissionDeniedPage,
  newSubAccountPage,
  subAccountConfirmationPage,
  sessionExpiredPage,
};
