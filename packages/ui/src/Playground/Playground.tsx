import { Select as BaseSelect } from "@base-ui/react/select";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import "../global.css";
import "./Playground.css";

export type ControlValue = boolean | number | string;

type SelectControl = {
  type: "select";
  label?: string;
  options: Array<{ label: string; value: string } | string>;
  defaultValue: string;
};

type BooleanControl = {
  type: "boolean";
  label?: string;
  defaultValue: boolean;
};

type TextControl = {
  type: "text";
  label?: string;
  defaultValue: string;
};

type NumberControl = {
  type: "number";
  label?: string;
  defaultValue: number;
  max?: number;
  min?: number;
  step?: number;
};

type SelectSchema = {
  label?: string;
  options: Array<{ label: string; value: string } | string>;
  value: string;
};

type NumberSchema = {
  label?: string;
  max?: number;
  min?: number;
  step?: number;
  value: number;
};

type Control = BooleanControl | NumberControl | SelectControl | TextControl;

type Controls = Record<string, Control>;

export type ControlsSchema = Record<
  string,
  boolean | number | NumberSchema | SelectSchema | string
>;

type ControlsValues<TSchema extends ControlsSchema> = {
  [K in keyof TSchema]: TSchema[K] extends { value: infer TValue } ? TValue : TSchema[K];
};

export class ControlsStore {
  private controls: Controls = {};
  private listeners = new Set<() => void>();
  private values: Record<string, ControlValue> = {};
  private version = 0;

  getSnapshot = () => this.version;

  getState() {
    return {
      controls: this.controls,
      values: this.values,
    };
  }

  getValues(fallbackControls?: Controls) {
    const controls = Object.keys(this.controls).length > 0 ? this.controls : fallbackControls;

    if (!controls) {
      return this.values;
    }

    return Object.fromEntries(
      Object.entries(controls).map(([name, control]) => [
        name,
        this.values[name] ?? control.defaultValue,
      ]),
    );
  }

  setControls(controls: Controls) {
    const defaults = getDefaults(controls);
    const nextValues = Object.fromEntries(
      Object.entries(defaults).map(([name, value]) => [name, this.values[name] ?? value]),
    );

    if (
      JSON.stringify(this.controls) === JSON.stringify(controls) &&
      JSON.stringify(this.values) === JSON.stringify(nextValues)
    ) {
      return;
    }

    this.controls = controls;
    this.values = nextValues;
    this.emit();
  }

  setValue(name: string, value: ControlValue) {
    this.values = {
      ...this.values,
      [name]: value,
    };
    this.emit();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    this.version += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

const defaultStore = new ControlsStore();

export function useCreateStore() {
  return useMemo(() => new ControlsStore(), []);
}

export function useControls<TSchema extends ControlsSchema>(
  schema: TSchema,
  options?: { store?: ControlsStore },
) {
  const store = options?.store ?? defaultStore;
  const controls = useMemo(() => normalizeControls(schema), [schema]);

  useEffect(() => {
    store.setControls(controls);
  }, [controls, store]);

  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return store.getValues(controls) as ControlsValues<TSchema>;
}

export function useSetControl(options?: { store?: ControlsStore }) {
  const store = options?.store ?? defaultStore;

  return useCallback((name: string, value: ControlValue) => store.setValue(name, value), [store]);
}

export function StoryBook(props: { children: ReactNode; store?: ControlsStore; title?: string }) {
  const store = props.store ?? defaultStore;
  const [panelOpen, setPanelOpen] = useState(true);
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { controls, values } = store.getState();

  return (
    <div className="clawbot-playground">
      <div className="clawbot-playground__preview">{props.children}</div>
      {panelOpen ? (
        <ControlsPanel
          controls={controls}
          title={props.title}
          values={values}
          onChange={(name, nextValue) => store.setValue(name, nextValue)}
          onClose={() => setPanelOpen(false)}
        />
      ) : (
        <button
          className="clawbot-playground__open"
          type="button"
          onClick={() => setPanelOpen(true)}
        >
          Tweaks
        </button>
      )}
    </div>
  );
}

function ControlsPanel(props: {
  controls: Controls;
  onChange: (name: string, value: ControlValue) => void;
  onClose: () => void;
  title?: string;
  values: Record<string, ControlValue>;
}) {
  return (
    <aside className="clawbot-playground__panel" aria-label={props.title ?? "Tweaks"}>
      <div className="clawbot-playground__panel-header">
        <h3 className="clawbot-playground__title">{props.title ?? "Tweaks"}</h3>
        <button
          aria-label="关闭控制面板"
          className="clawbot-playground__close"
          type="button"
          onClick={props.onClose}
        >
          <span aria-hidden="true" />
        </button>
      </div>
      <div className="clawbot-playground__controls">
        {Object.entries(props.controls).map(([name, control]) => (
          <ControlField
            key={name}
            name={name}
            control={control}
            value={props.values[name] ?? control.defaultValue}
            onChange={(nextValue) => props.onChange(name, nextValue)}
          />
        ))}
      </div>
    </aside>
  );
}

function getDefaults<TControls extends Controls>(controls: TControls) {
  return Object.fromEntries(
    Object.entries(controls).map(([name, control]) => [name, control.defaultValue]),
  ) as Record<string, ControlValue>;
}

function normalizeControls(schema: ControlsSchema): Controls {
  return Object.fromEntries(
    Object.entries(schema).map(([name, value]) => {
      if (typeof value === "boolean") {
        return [name, { type: "boolean", defaultValue: value }];
      }

      if (typeof value === "number") {
        return [name, { type: "number", defaultValue: value }];
      }

      if (typeof value === "string") {
        return [name, { type: "text", defaultValue: value }];
      }

      if ("options" in value) {
        return [
          name,
          {
            type: "select",
            label: value.label,
            options: value.options,
            defaultValue: value.value,
          },
        ];
      }

      return [
        name,
        {
          type: "number",
          label: value.label,
          max: value.max,
          min: value.min,
          step: value.step,
          defaultValue: value.value,
        },
      ];
    }),
  );
}

function ControlField(props: {
  control: Control;
  name: string;
  onChange: (value: ControlValue) => void;
  value: ControlValue;
}) {
  const label = props.control.label ?? props.name;

  if (props.control.type === "boolean") {
    return (
      <label className="clawbot-playground__switch-field">
        <span className="clawbot-playground__label">{label}</span>
        <BaseSwitch.Root
          aria-label={label}
          checked={Boolean(props.value)}
          className="clawbot-playground__switch"
          onCheckedChange={(checked) => props.onChange(checked)}
        >
          <BaseSwitch.Thumb className="clawbot-playground__switch-thumb" />
        </BaseSwitch.Root>
      </label>
    );
  }

  if (props.control.type === "select") {
    const options = props.control.options.map((option) =>
      typeof option === "string" ? { label: option, value: option } : option,
    );
    const selected = options.find((option) => option.value === String(props.value));

    return (
      <div className="clawbot-playground__field">
        <span className="clawbot-playground__label">{label}</span>
        <BaseSelect.Root
          items={options}
          modal={false}
          value={String(props.value)}
          onValueChange={(nextValue) => {
            if (typeof nextValue === "string") {
              props.onChange(nextValue);
            }
          }}
        >
          <BaseSelect.Trigger className="clawbot-playground__select-trigger">
            <BaseSelect.Value className="clawbot-playground__select-value">
              {selected?.label ?? String(props.value)}
            </BaseSelect.Value>
            <span className="clawbot-playground__select-icon" aria-hidden="true" />
          </BaseSelect.Trigger>
          <BaseSelect.Portal>
            <BaseSelect.Positioner
              alignItemWithTrigger={false}
              className="clawbot-playground__select-positioner"
              sideOffset={8}
            >
              <BaseSelect.Popup className="clawbot-playground__select-popup">
                {options.map((option) => (
                  <BaseSelect.Item
                    key={option.value}
                    className="clawbot-playground__select-item"
                    label={option.label}
                    value={option.value}
                  >
                    <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                    <BaseSelect.ItemIndicator className="clawbot-playground__select-indicator">
                      ✓
                    </BaseSelect.ItemIndicator>
                  </BaseSelect.Item>
                ))}
              </BaseSelect.Popup>
            </BaseSelect.Positioner>
          </BaseSelect.Portal>
        </BaseSelect.Root>
      </div>
    );
  }

  return (
    <label className="clawbot-playground__field">
      <span className="clawbot-playground__label">{label}</span>
      <input
        className="clawbot-playground__input"
        max={props.control.type === "number" ? props.control.max : undefined}
        min={props.control.type === "number" ? props.control.min : undefined}
        step={props.control.type === "number" ? props.control.step : undefined}
        type={props.control.type === "number" ? "number" : "text"}
        value={String(props.value)}
        onChange={(event) =>
          props.onChange(
            props.control.type === "number" ? Number(event.target.value) : event.target.value,
          )
        }
      />
    </label>
  );
}
