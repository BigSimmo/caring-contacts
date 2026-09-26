// Standalone extract of PsychSift's vitest.config.mts, keeping only what Caring Contacts uses.
//
// The database suites need a real Postgres named by CARING_CONTACTS_DATABASE_URL. They are
// collected only when caring-contacts/run-db-tests.mjs sets CARING_CONTACTS_DB_TESTS=1, so a
// plain `npm test` never touches a database.
const caringContactsDbTests =
  process.env.CARING_CONTACTS_DB_TESTS === "1" && (process.env.CARING_CONTACTS_DATABASE_URL ?? "").trim() !== "";
const caringContactsDbTestFiles = [
  "tests/caring-contacts-migrations.test.ts",
  "tests/caring-contacts-postgres-repository.test.ts",
];

const config = {
  test: {
    testTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: [...caringContactsDbTestFiles],
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["tests/**/*.dom.test.tsx"],
          setupFiles: ["tests/setup/jsdom.setup.ts"],
        },
      },
      ...(caringContactsDbTests
        ? [
            {
              extends: true,
              test: {
                name: "caring-contacts-db",
                environment: "node",
                include: [...caringContactsDbTestFiles],
                // One database, one schema: parallel files would truncate each other's rows.
                fileParallelism: false,
                testTimeout: 60_000,
                hookTimeout: 60_000,
              },
            },
          ]
        : []),
    ],
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "server-only": new URL("./tests/stubs/server-only.ts", import.meta.url).pathname,
    },
  },
};

export default config;
