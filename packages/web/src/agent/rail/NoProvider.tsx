import { RefreshCw } from "lucide-react";
import { platform } from "../../canvas/platform.ts";
import { PROVIDERS, providerName } from "../providers.ts";
import { useProviders, type ChatClient } from "../store.ts";

/**
 * The rail with no provider ready: each provider's status, how to install a missing one,
 * and Check again. Nothing is sent anywhere until one is ready.
 */
export const NoProvider = ({ client }: { readonly client: ChatClient }) => {
  const { statuses, checking } = useProviders(client);
  return (
    <div className="unframed-agent-noprovider" data-testid="no-provider">
      <p className="unframed-agent-noprovider__lead">{`No Claude or Codex found on this ${platform() === "darwin" ? "Mac" : "computer"}.`}</p>
      <p>Install one and sign in, and the agent runs on your plan. Nothing is sent anywhere until then.</p>
      <ul>
        {PROVIDERS.map((provider) => {
          const status = statuses?.[provider];
          const detail = checking ? "checking…" : status === undefined ? "not checked yet" : (status.message ?? status.status);
          return (
            <li key={provider} data-provider={provider}>
              <strong>{providerName(provider)}</strong>
              {` · ${detail}`}
              {!checking && status?.status === "not_installed" && (
                <>
                  {" "}
                  <a href={status.install} target="_blank" rel="noopener noreferrer">
                    How to install
                  </a>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" className="unframed-agent-button" aria-busy={checking || undefined} disabled={checking} onClick={() => void client.loadProviders(true)}>
        <RefreshCw size={14} aria-hidden className={checking ? "animate-spin" : undefined} />
        Check again
      </button>
    </div>
  );
};
