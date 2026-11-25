import { cva, type VariantProps } from "class-variance-authority";
import { Children, isValidElement } from "react";
import type * as React from "react";

import { cn } from "~/lib/utils";

const alertVariants = cva("relative rounded-xl border px-3.5 py-3 text-(--alert-foreground) text-sm [--alert-tint:transparent] data-[variant=error]:[--alert-tint:var(--alert-error-tint)] data-[variant=info]:[--alert-tint:var(--alert-info-tint)] data-[variant=success]:[--alert-tint:var(--alert-success-tint)] data-[variant=warning]:[--alert-tint:var(--alert-warning-tint)]", {
  defaultVariants: {
    surface: "default",
    variant: "default",
  },
  variants: {
    // "glass" floats the alert over content; alert-glass tints from data-variant.
    surface: {
      default: "",
      glass: "alert-glass",
    },
    variant: {
      default: "border-(--alert-default-border) bg-(--alert-default-surface)/(--alert-default-surface-opacity) [&_svg]:text-(--alert-default-icon)",
      sidebar:
        "rounded-lg border-(--alert-sidebar-border) bg-(--alert-sidebar-surface) px-2 py-1.5 text-2xs leading-4 [&_[data-slot=alert-description]]:block [&_[data-slot=alert-description]]:text-(--alert-sidebar-description)",
      error:
        "border-(--alert-error-border)/(--alert-error-border-opacity) bg-(--alert-error-surface) text-(--alert-error-foreground) [&_[data-slot=alert-description]]:text-(--alert-error-description)/(--alert-error-description-opacity) [&_svg]:text-(--alert-error-icon)",
      info: "border-(--alert-info-border)/(--alert-info-border-opacity) bg-(--alert-info-surface)/(--alert-info-surface-opacity) [&_svg]:text-(--alert-info-icon)",
      success: "border-(--alert-success-border)/(--alert-success-border-opacity) bg-(--alert-success-surface)/(--alert-success-surface-opacity) [&_svg]:text-(--alert-success-icon)",
      warning:
        "border-(--alert-warning-border)/(--alert-warning-border-opacity) bg-(--alert-warning-surface) text-(--alert-warning-foreground) [&_[data-slot=alert-description]]:text-(--alert-warning-description)/(--alert-warning-description-opacity) [&_svg]:text-(--alert-warning-icon)",
    },
  },
});

function alertChildSlot(child: React.ReactElement): string | undefined {
  const propsSlot = (child.props as Record<string, string | undefined>)["data-slot"];
  if (propsSlot) {
    return propsSlot;
  }

  const type = child.type as { displayName?: string; name?: string };
  switch (type.displayName ?? type.name) {
    case "AlertAction":
      return "alert-action";
    case "AlertTitle":
      return "alert-title";
    case "AlertDescription":
      return "alert-description";
    default:
      return undefined;
  }
}

function Alert({
  className,
  variant,
  surface,
  controlAlignment = "center",
  children,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof alertVariants> & {
    controlAlignment?: "center" | "first-line";
  }) {
  const icon: React.ReactNode[] = [];
  const content: React.ReactNode[] = [];
  const action: React.ReactNode[] = [];

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) {
      content.push(child);
      return;
    }
    const slot = alertChildSlot(child);
    if (slot === "alert-action") {
      action.push(child);
    } else if (slot === "alert-title" || slot === "alert-description") {
      content.push(child);
    } else {
      icon.push(child);
    }
  });

  return (
    <div
      className={cn(alertVariants({ surface, variant }), className)}
      data-slot="alert"
      data-variant={variant ?? "default"}
      role="alert"
      {...props}
    >
      <div
        className={cn(
          "flex gap-2",
          controlAlignment === "first-line" ? "items-start" : "items-center",
          controlAlignment === "first-line" &&
            action.length > 0 &&
            "min-h-7 pt-1 sm:min-h-6 sm:pt-0.5",
        )}
      >
        {icon.length > 0 && (
          <div
            className={cn(
              "flex shrink-0 items-center justify-center",
              controlAlignment === "first-line"
                ? "h-lh w-4 [&>svg]:size-4"
                : "size-4 [&>svg]:size-full",
            )}
          >
            {icon}
          </div>
        )}
        {content.length > 0 && (
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">{content}</div>
        )}
        {action.length > 0 && (
          <div
            className={cn(
              "flex shrink-0 items-center",
              controlAlignment === "first-line" ? "h-lh self-start" : "self-center",
            )}
          >
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("font-medium", className)} data-slot="alert-title" {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-2.5 text-(--alert-description)", className)}
      data-slot="alert-description"
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex gap-1", className)} data-slot="alert-action" {...props} />;
}

AlertTitle.displayName = "AlertTitle";
AlertDescription.displayName = "AlertDescription";
AlertAction.displayName = "AlertAction";

export { Alert, AlertTitle, AlertDescription, AlertAction };
