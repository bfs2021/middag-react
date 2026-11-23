# Changelog

## [0.1.1](https://github.com/middag-io/middag-react/compare/ui-contracts-codegen-v0.1.0...ui-contracts-codegen-v0.1.1) (2026-11-23)


### Bug Fixes

* **ui-contracts:** replace the enum catch with open enums for presentational values ([65cdc00](https://github.com/middag-io/middag-react/commit/65cdc0052facc85f0bc77000a86d67a7820d278e))

## 0.1.0 (2026-11-19)


### Features

* **contracts-codegen:** add the @middag-io/ui-contracts-codegen package ([7b052a9](https://github.com/middag-io/middag-react/commit/7b052a9df782a1850a356bfea74ff0e77e603b70))
* **contracts-codegen:** add the @middag-io/ui-contracts-codegen package ([58a1329](https://github.com/middag-io/middag-react/commit/58a1329cb8d04725c403f07edc2a736f24b82c3a))

### Consumer impact

The generator reads an `openEnums` list from `contracts.config.json`; those enums emit a union of the strict enum and `z.string()`. Other enums are unchanged.

