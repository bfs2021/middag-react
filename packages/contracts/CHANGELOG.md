# Changelog

## [0.2.0](https://github.com/middag-io/middag-react/compare/ui-contracts-v0.1.0...ui-contracts-v0.2.0) (2026-11-23)


### Features

* **ui-contracts:** accept richtext, time, autocomplete and translatable or null section labels ([25f8d72](https://github.com/middag-io/middag-react/commit/25f8d72a236659a565fadbf51f49d566222176b3))


### Bug Fixes

* **ui-contracts:** mirror the released middag-php-ui v1.11.0 schemas ([4b01e47](https://github.com/middag-io/middag-react/commit/4b01e47011470c81b8eb83b8c46c2fff196a442c))
* **ui-contracts:** replace the enum catch with open enums for presentational values ([65cdc00](https://github.com/middag-io/middag-react/commit/65cdc0052facc85f0bc77000a86d67a7820d278e))

## 0.1.0 (2026-11-19)


### Features

* **ui-contracts:** add the @middag-io/ui-contracts package ([4609d30](https://github.com/middag-io/middag-react/commit/4609d30fe818c2de07d7addda4af29ae62a906a7))


### Refactoring

* **contracts:** generate the wire contract through @middag-io/ui-contracts ([a77f9ff](https://github.com/middag-io/middag-react/commit/a77f9ff4588489534f617b7594ff89042c132b59))

### Consumer impact

Presentational enums (`ActionIntent`, `NotificationLevel`, `ThemeMode`, `ValueFormat`, `ColumnVariant`, `FilterType`, `ChartType`, `FormComponent`, `FieldType`) now accept an unknown string and keep its raw value (the TypeScript type adds `(string & {})`); control enums stay strict. The package also accepts the `richtext`, `time` and `autocomplete` form components.

