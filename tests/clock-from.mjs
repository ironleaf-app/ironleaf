// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs this test file's clock from a chosen day. Samples with written dates meet code that counts days on the real
// clock (the Bin's 30 days, how lately a PC opened the vault), so without this they stop passing a month later.
export function clockFrom(day) {
  const Real = Date;
  const off = day.getTime() - Real.now();
  globalThis.Date = class extends Real {
    constructor(...a) {
      if (a.length) super(...a);
      else super(Real.now() + off);
    }
    static now() {
      return Real.now() + off;
    }
  };
}
