const express = require("express");
const session = require("express-session");
const { findMember, nextConfirmationNumber } = require("./data");
const tpl = require("./templates");

const app = express();
const PORT = process.env.MOCK_BANK_PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: "mock-bank-dev-secret-not-for-prod",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 5 * 60 * 1000 },
  })
);

function requireLogin(req, res, next) {
  if (!req.session || !req.session.loggedIn) {
    res.status(401).send(tpl.sessionExpiredPage());
    return;
  }
  next();
}

app.get("/", (req, res) => res.redirect("/login"));

app.get("/login", (req, res) => {
  res.send(tpl.loginPage(null));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).send(tpl.loginPage("Teller ID and password are required."));
    return;
  }
  req.session.loggedIn = true;
  req.session.username = username;
  res.redirect("/members/search");
});

app.get("/members/search", requireLogin, (req, res) => {
  const { memberId } = req.query;
  if (!memberId) {
    res.send(tpl.searchPage("", null));
    return;
  }
  const member = findMember(String(memberId).trim());
  if (!member) {
    res.status(404).send(tpl.searchPage("", `No member found with ID "${memberId}".`));
    return;
  }
  res.send(tpl.searchPage(tpl.resultRow(member), null));
});

app.get("/members/:id", requireLogin, (req, res) => {
  const member = findMember(req.params.id);
  if (!member) {
    res.status(404).send(tpl.notFoundPage(req.params.id));
    return;
  }
  if (member.flags.permissionRestricted) {
    res.status(403).send(tpl.permissionDeniedPage(req.params.id));
    return;
  }

  const render = () => res.send(tpl.memberDetailPage(member));

  if (member.flags.expireSessionOnView) {
    // Simulate a session that dies right as the record is opened: the page
    // renders, but the session backing it is already gone, so the *next*
    // action in the flow (e.g. following a link) will hit requireLogin's 401.
    req.session.destroy(() => render());
    return;
  }

  if (member.flags.slowLoad) {
    setTimeout(render, 3000);
    return;
  }

  render();
});

app.get("/members/:id/sub-accounts/new", requireLogin, (req, res) => {
  const member = findMember(req.params.id);
  if (!member) {
    res.status(404).send(tpl.notFoundPage(req.params.id));
    return;
  }
  if (member.flags.permissionRestricted) {
    res.status(403).send(tpl.permissionDeniedPage(req.params.id));
    return;
  }
  res.send(tpl.newSubAccountPage(member, null));
});

app.post("/members/:id/sub-accounts", requireLogin, (req, res) => {
  const member = findMember(req.params.id);
  if (!member) {
    res.status(404).send(tpl.notFoundPage(req.params.id));
    return;
  }
  const { accountType, initialDeposit } = req.body;
  const deposit = Number(initialDeposit);

  if (!accountType || Number.isNaN(deposit) || deposit < 25) {
    res
      .status(400)
      .send(
        tpl.newSubAccountPage(
          member,
          "Initial deposit must be a number of at least $25.00."
        )
      );
    return;
  }

  const confirmationNumber = nextConfirmationNumber();
  res.send(
    tpl.subAccountConfirmationPage(member, accountType, deposit, confirmationNumber)
  );
});

app.listen(PORT, () => {
  console.log(`mock-bank listening on http://localhost:${PORT}`);
});
