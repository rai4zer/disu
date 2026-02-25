import type { SVGProps } from "react";

type DisuLogoProps = SVGProps<SVGSVGElement> & {
  title?: string;
};

export default function DisuLogo({ className, title = "DISU", ...props }: DisuLogoProps) {
  return (
    <svg
      viewBox="0 0 280 92"
      width="280"
      height="92"
      className={className}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMinYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <title>{title}</title>
      <text
        x="0"
        y="46"
        fill="currentColor"
        fontSize="54"
        fontWeight="800"
        letterSpacing="8"
        fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
      >
        DISU
      </text>
      <text
        x="0"
        y="82"
        fill="currentColor"
        opacity="0.7"
        fontSize="27"
        fontWeight="400"
        fontFamily="'Noto Sans Cuneiform', serif"
      >
        𒁲𒋢
      </text>
    </svg>
  );
}
