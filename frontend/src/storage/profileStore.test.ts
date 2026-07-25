import { describe, expect, it } from "vitest";
import { deleteProfile, listProfiles, saveProfile } from "./profileStore.js";

describe("profile store", () => {
  it("saves, lists, and deletes profiles", async () => {
    await saveProfile({
      id: "1",
      name: "Home NAS",
      host: "192.168.1.50",
      port: 22,
      username: "admin",
      folder: null,
    });

    expect(await listProfiles()).toEqual([
      {
        id: "1",
        name: "Home NAS",
        host: "192.168.1.50",
        port: 22,
        username: "admin",
        folder: null,
      },
    ]);

    await deleteProfile("1");
    expect(await listProfiles()).toEqual([]);
  });
});
