// Manage who can use the inbox: the `operator` custom claim on Firebase Auth
// accounts, which firestore.rules and the /api/whatsapp routes require.
//
//   npm run operators -- grant someone@example.com
//   npm run operators -- grant someone@example.com --reset-existing
//   npm run operators -- revoke someone@example.com
//   npm run operators -- list
//
// `grant` creates the account and prints a link where the operator chooses
// their password. While public sign-up is (or was) enabled, anyone could have
// registered an address first, with a password of their own; so if an
// account already exists, `grant` refuses unless you pass --reset-existing,
// which replaces its password, removes other sign-in methods and signs it out
// everywhere before granting access. `revoke` removes access and signs the
// account out. Uses the FIREBASE_ADMIN_* values from .env.local.
import { randomBytes } from "node:crypto";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const CLAIM = "operator";
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [command, email] = args.filter((a) => !a.startsWith("--"));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function adminAuth() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey) {
    fail(
      "Set FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY in .env.local."
    );
  }
  return getAuth(initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }));
}

/** A password nobody knows; the operator sets their own through the reset link. */
function throwawayPassword() {
  return randomBytes(32).toString("base64url");
}

async function findUser(auth, address) {
  try {
    return await auth.getUserByEmail(address);
  } catch (e) {
    if (e?.code === "auth/user-not-found") return null;
    throw e;
  }
}

function describe(user) {
  const providers = user.providerData.map((p) => p.providerId).join(", ") || "none";
  return [
    `  created:        ${user.metadata.creationTime}`,
    `  last sign-in:   ${user.metadata.lastSignInTime ?? "never"}`,
    `  email verified: ${user.emailVerified}`,
    `  sign-in with:   ${providers}`,
  ].join("\n");
}

async function grant(auth) {
  if (!email) fail("Usage: npm run operators -- grant <email> [--reset-existing]");
  let user = await findUser(auth, email);

  if (!user) {
    user = await auth.createUser({ email, password: throwawayPassword() });
    console.log(`Created an account for ${email}.`);
  } else if (user.customClaims?.[CLAIM] === true && !flags.has("--reset-existing")) {
    console.log(`${email} is already an operator.`);
    if (!user.metadata.lastSignInTime) {
      // Granted, but never used (e.g. an earlier run failed before printing
      // the link): a fresh link changes nothing until it is used.
      console.log("They haven't signed in yet. Send them this link to choose their password:");
      console.log(await auth.generatePasswordResetLink(email));
    } else {
      console.log("To issue a new password link, run grant again with --reset-existing.");
    }
    return;
  } else if (!flags.has("--reset-existing")) {
    fail(
      [
        `An account for ${email} already exists:`,
        describe(user),
        "",
        "If someone else registered this address while sign-up was open, granting it would give them",
        "the inbox. Re-run with --reset-existing to replace its password, remove other sign-in methods",
        "and sign it out everywhere first; you'll get a link for the real owner to set a new password.",
      ].join("\n")
    );
  } else {
    // Lock out whoever holds the account now, before it gets access.
    const providers = user.providerData.map((p) => p.providerId);
    // A phone sign-in is removed by clearing the number; firebase-admin
    // refuses to also list "phone" in providersToUnlink.
    const otherProviders = providers.filter((id) => id !== "password" && id !== "phone");
    const hasPhone = Boolean(user.phoneNumber) || providers.includes("phone");
    const updated = await auth.updateUser(user.uid, {
      password: throwawayPassword(),
      ...(otherProviders.length ? { providersToUnlink: otherProviders } : {}),
      ...(hasPhone ? { phoneNumber: null } : {}),
    });
    await auth.revokeRefreshTokens(user.uid);
    const remaining = (updated?.providerData ?? []).map((p) => p.providerId).filter((id) => id !== "password");
    if (updated?.phoneNumber || remaining.length) {
      fail(`Could not remove other sign-in methods from ${email} (${remaining.join(", ") || "phone"}); not granting access.`);
    }
    console.log(`Reset ${email}: new unknown password, other sign-in methods removed, signed out everywhere.`);
  }

  // The link first: if it fails, no access has been granted and a re-run starts clean.
  const link = await auth.generatePasswordResetLink(email);
  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), [CLAIM]: true });
  console.log(`${email} is now an operator.`);
  console.log("Send them this link to choose their password (it expires; run grant again for a new one");
  console.log("with --reset-existing):");
  console.log(link);
}

async function revoke(auth) {
  if (!email) fail("Usage: npm run operators -- revoke <email>");
  const user = await findUser(auth, email);
  if (!user) fail(`No account for ${email}.`);
  const claims = { ...(user.customClaims ?? {}) };
  delete claims[CLAIM];
  await auth.setCustomUserClaims(user.uid, claims);
  // Ends existing sessions, so the old token (which still has the claim) stops working.
  await auth.revokeRefreshTokens(user.uid);
  console.log(`${email} is no longer an operator and has been signed out.`);
}

async function list(auth) {
  let pageToken;
  let count = 0;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      if (user.customClaims?.[CLAIM] === true) {
        count++;
        console.log(`${user.email ?? "(no email)"}  ${user.uid}${user.disabled ? "  (disabled)" : ""}`);
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);
  console.log(count === 0 ? "No operators yet." : `${count} operator(s).`);
}

async function main() {
  const commands = { grant, revoke, list };
  if (!Object.hasOwn(commands, command ?? "")) {
    fail("Usage: npm run operators -- grant <email> [--reset-existing] | revoke <email> | list");
  }
  await commands[command](adminAuth());
}

main().catch((e) => fail(e?.message ?? String(e)));
