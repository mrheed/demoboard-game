import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";

const cwd = process.cwd();
let root: string;
const account = privateKeyToAccount(`0x${"d1".repeat(32)}`);

before(async () => {
  root = await mkdtemp(join(tmpdir(), "board-mock-auth-test-"));
  process.chdir(root);
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  process.env.NEXT_PUBLIC_CHAIN_ENV = "testnet";
});

after(async () => {
  process.chdir(cwd);
  await rm(root, { recursive: true, force: true });
});

test("mock wallet logout revokes the real token instead of reporting a fake count", async () => {
  const auth = await import("../src/server/services/wallet-auth.service");
  const { resolveSessionToken } = await import("../src/server/services/auth.service");
  const { logoutSessions } = await import("../src/server/services/logout.service");
  const challenge = await auth.issueWalletLoginChallenge(account.address);
  const login = await auth.loginWithWallet({
    address: account.address,
    message: challenge.message,
    signature: await account.signMessage({ message: challenge.message }),
  });
  assert.ok(await resolveSessionToken(login.session.token));
  const result = await logoutSessions({
    userId: login.user.id,
    token: login.session.token,
  });
  assert.equal(result.revoked, 1);
  assert.equal(await resolveSessionToken(login.session.token), null);
  assert.equal((await logoutSessions({ userId: login.user.id, token: login.session.token })).revoked, 0);
});
