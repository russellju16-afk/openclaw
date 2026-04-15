import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClawdbotConfig } from "../runtime-api.js";

const createFeishuClientMock = vi.hoisted(() => vi.fn());

vi.mock("./client.js", () => ({
  createFeishuClient: createFeishuClientMock,
}));

const freshDirectoryModulePath = "./directory.js?directory-test";
const {
  listFeishuDirectoryGroups,
  listFeishuDirectoryGroupsLive,
  listFeishuDirectoryPeers,
  listFeishuDirectoryPeersLive,
} = await import(freshDirectoryModulePath);

function makeStaticCfg(): ClawdbotConfig {
  return {
    channels: {
      feishu: {
        allowFrom: ["user:alice", "user:bob"],
        dms: {
          "user:carla": {},
        },
        groups: {
          "chat-1": {},
        },
        groupAllowFrom: ["chat-2"],
      },
    },
  } as ClawdbotConfig;
}

function makeConfiguredCfg(): ClawdbotConfig {
  return {
    channels: {
      feishu: {
        ...makeStaticCfg().channels?.feishu,
        appId: "cli_test_app_id",
        appSecret: "cli_test_app_secret",
      },
    },
  } as ClawdbotConfig;
}

describe("feishu directory (config-backed)", () => {
  beforeEach(() => {
    createFeishuClientMock.mockReset();
  });

  it("merges allowFrom + dms into peer entries", async () => {
    const peers = await listFeishuDirectoryPeers({ cfg: makeStaticCfg(), query: "a" });
    expect(peers).toEqual([
      { kind: "user", id: "alice" },
      { kind: "user", id: "carla" },
    ]);
  });

  it("normalizes spaced provider-prefixed peer entries", async () => {
    const cfg = {
      channels: {
        feishu: {
          allowFrom: [" feishu:user:ou_alice "],
          dms: {
            " lark:dm:ou_carla ": {},
          },
          groups: {},
          groupAllowFrom: [],
        },
      },
    } as ClawdbotConfig;

    const peers = await listFeishuDirectoryPeers({ cfg });
    expect(peers).toEqual([
      { kind: "user", id: "ou_alice" },
      { kind: "user", id: "ou_carla" },
    ]);
  });

  it("merges groups map + groupAllowFrom into group entries", async () => {
    const groups = await listFeishuDirectoryGroups({ cfg: makeStaticCfg() });
    expect(groups).toEqual([
      { kind: "group", id: "chat-1" },
      { kind: "group", id: "chat-2" },
    ]);
  });

  it("falls back to static peers on live lookup failure by default", async () => {
    createFeishuClientMock.mockReturnValueOnce({
      contact: {
        department: {
          children: vi.fn(async () => {
            throw new Error("token expired");
          }),
        },
        user: {
          list: vi.fn(async () => {
            throw new Error("token expired");
          }),
        },
      },
    });

    const peers = await listFeishuDirectoryPeersLive({ cfg: makeConfiguredCfg(), query: "a" });
    expect(peers).toEqual([
      { kind: "user", id: "alice" },
      { kind: "user", id: "carla" },
    ]);
  });

  it("searches visible department users by name for live peer lookup", async () => {
    const children = vi.fn(async () => ({
      code: 0,
      data: {
        items: [
          { open_department_id: "od_sales", name: "销售" },
          { open_department_id: "od_ops", name: "运营" },
        ],
      },
    }));
    const findByDepartment = vi.fn(async ({ params }: { params: { department_id: string } }) => {
      switch (params.department_id) {
        case "0":
          return { code: 0, data: { items: [{ open_id: "ou_root", name: "俱敏含" }] } };
        case "od_sales":
          return {
            code: 0,
            data: {
              items: [
                {
                  open_id: "ou_target",
                  user_id: "u_target",
                  union_id: "on_target",
                  name: "李元甲",
                },
              ],
            },
          };
        case "od_ops":
          return {
            code: 0,
            data: {
              items: [
                {
                  open_id: "ou_target",
                  user_id: "u_target",
                  union_id: "on_target",
                  name: "李元甲",
                },
              ],
            },
          };
        default:
          return { code: 0, data: { items: [] } };
      }
    });

    createFeishuClientMock.mockReturnValueOnce({
      contact: {
        department: { children },
        user: {
          findByDepartment,
        },
      },
    });

    const peers = await listFeishuDirectoryPeersLive({
      cfg: makeConfiguredCfg(),
      query: "李元甲",
      fallbackToStatic: false,
    });

    expect(children).toHaveBeenCalledWith({
      path: { department_id: "0" },
      params: {
        department_id_type: "open_department_id",
        fetch_child: true,
        page_size: 50,
      },
    });
    expect(findByDepartment).toHaveBeenCalledWith({
      params: {
        department_id: "0",
        department_id_type: "open_department_id",
        page_size: 50,
        user_id_type: "open_id",
      },
    });
    expect(peers).toEqual([
      {
        kind: "user",
        id: "ou_target",
        name: "李元甲",
        userId: "u_target",
        unionId: "on_target",
        stablePersonKey: "on_target",
        preferredSendTarget: "user:u_target",
      },
    ]);
  });

  it("surfaces live peer lookup failures when fallback is disabled", async () => {
    createFeishuClientMock.mockReturnValueOnce({
      contact: {
        department: {
          children: vi.fn(async () => {
            throw new Error("token expired");
          }),
        },
        user: {
          list: vi.fn(async () => {
            throw new Error("token expired");
          }),
        },
      },
    });

    await expect(
      listFeishuDirectoryPeersLive({ cfg: makeConfiguredCfg(), fallbackToStatic: false }),
    ).rejects.toThrow("token expired");
  });

  it("surfaces live group lookup failures when fallback is disabled", async () => {
    createFeishuClientMock.mockReturnValueOnce({
      im: {
        chat: {
          list: vi.fn(async () => ({ code: 999, msg: "forbidden" })),
        },
      },
    });

    await expect(
      listFeishuDirectoryGroupsLive({ cfg: makeConfiguredCfg(), fallbackToStatic: false }),
    ).rejects.toThrow("forbidden");
  });
});
