import type { LegacyConfigRule } from "../../config/legacy.shared.js";
import { loadBundledPluginPublicArtifactModuleSync } from "../../plugins/public-surface-loader.js";

type BundledChannelDoctorContractApi = {
  legacyConfigRules?: readonly LegacyConfigRule[];
};

function loadBundledChannelPublicArtifact(
  channelId: string,
  artifactBasenames: readonly string[],
): BundledChannelDoctorContractApi | undefined {
  for (const artifactBasename of artifactBasenames) {
    try {
      return loadBundledPluginPublicArtifactModuleSync<BundledChannelDoctorContractApi>({
        dirName: channelId,
        artifactBasename,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Unable to resolve bundled plugin public surface ")
      ) {
        // Artifact file is absent for this candidate — try the next basename.
        continue;
      }
      // Any other error (module eval crash, syntax error, etc.) means the
      // artifact exists but is broken. Surface it so doctor --fix isn't a no-op.
      throw error;
    }
  }
  return undefined;
}

export function loadBundledChannelDoctorContractApi(
  channelId: string,
): BundledChannelDoctorContractApi | undefined {
  return loadBundledChannelPublicArtifact(channelId, ["doctor-contract-api.js", "contract-api.js"]);
}
