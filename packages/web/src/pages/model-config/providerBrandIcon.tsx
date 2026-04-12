import anthropicIcon from "../../assets/images/providers/anthropic.svg";
import azureOpenAiIcon from "../../assets/images/providers/azure-openai.svg";
import deepseekIcon from "../../assets/images/providers/deepseek.svg";
import googleIcon from "../../assets/images/providers/google.svg";
import kimiIcon from "../../assets/images/providers/kimi.svg";
import moonshotIcon from "../../assets/images/providers/moonshot.svg";
import openaiIcon from "../../assets/images/providers/openai.svg";
import openrouterIcon from "../../assets/images/providers/openrouter.svg";
import { CpuIcon } from "../../components/ui/icons.js";
import { cn } from "../../lib/cn.js";
import { getProviderBrandKey, type ProviderBrandKey } from "./providerBrand.js";

const PROVIDER_BRAND_ICON_MAP: Record<ProviderBrandKey, string> = {
  openai: openaiIcon,
  anthropic: anthropicIcon,
  google: googleIcon,
  deepseek: deepseekIcon,
  moonshot: moonshotIcon,
  kimi: kimiIcon,
  openrouter: openrouterIcon,
  "azure-openai": azureOpenAiIcon,
};

export function ProviderBrandIcon(props: { provider: string; className?: string }) {
  const brandKey = getProviderBrandKey(props.provider);

  if (!brandKey) {
    return <CpuIcon className={props.className} />;
  }

  return (
    <img
      src={PROVIDER_BRAND_ICON_MAP[brandKey]}
      alt=""
      aria-hidden="true"
      className={cn("object-contain", props.className)}
      draggable={false}
    />
  );
}
