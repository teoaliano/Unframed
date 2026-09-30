import { RefreshCw, Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "~/components/ui/empty";
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
    <Empty size="compact" data-testid="no-provider">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Sparkles aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{`No Claude or Codex found on this ${platform() === "darwin" ? "Mac" : "computer"}.`}</EmptyTitle>
        <EmptyDescription>Install one and sign in, and the agent runs on your plan. Nothing is sent anywhere until then.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {/* A status list, not an interruption: the kit Alert's frame without its alert role. */}
        <Alert role="status" className="w-full">
          <AlertDescription>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-left">
              {PROVIDERS.map((provider) => {
                const status = statuses?.[provider];
                const detail = checking ? "checking…" : status === undefined ? "not checked yet" : (status.message ?? status.status);
                return (
                  <li key={provider} data-provider={provider}>
                    <strong className="font-medium text-foreground">{providerName(provider)}</strong>
                    {` · ${detail}`}
                    {!checking && status?.status === "not_installed" && (
                      <>
                        {" "}
                        <a href={status.install} target="_blank" rel="noopener noreferrer" className="text-info-foreground underline-offset-4 hover:underline">
                          How to install
                        </a>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" aria-busy={checking || undefined} disabled={checking} onClick={() => void client.loadProviders(true)}>
          <RefreshCw aria-hidden className={checking ? "animate-spin" : undefined} />
          Check again
        </Button>
      </EmptyContent>
    </Empty>
  );
};
