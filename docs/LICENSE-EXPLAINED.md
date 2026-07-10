# openMemo licence, in plain English

openMemo is licensed under the **GNU Affero General Public License v3.0
(AGPL-3.0)**. The legally binding text lives in [`LICENSE`](../LICENSE) at the
repo root, with an attribution term in [`NOTICE`](../NOTICE). This page is the
human-readable walkthrough. If the two ever disagree, `LICENSE` and `NOTICE`
win.

## You can

- ✅ Use openMemo freely, without payment or restrictions
- ✅ Modify the source code to fit your needs
- ✅ Run it on your own servers or self-host locally
- ✅ Redistribute modified versions

## You must

- ⚠️ Share improvements back: any modifications must be open sourced
- ⚠️ Include the license and copyright notice with distributions
- ⚠️ Disclose the source: if you run openMemo as a service, users accessing it remotely must be able to download the source code
- ⚠️ Use AGPL for derivative works: you cannot relicense as MIT, proprietary, or other licenses
- ⚠️ Keep the credit: distributed or modified versions must show "Based on openMemo by DIR (dev.izo.red)" somewhere their users can see it (full terms in [`NOTICE`](../NOTICE), added under AGPL v3 section 7(b))

## The copyleft requirement

AGPL is a **strong copyleft** license. If you modify openMemo, you must:

1. **Release modifications publicly.** You cannot keep improvements private.
2. **Use AGPL for derivatives.** If you fork or extend openMemo, your project must also be AGPL.
3. **Attribute correctly.** Credit the original author (see `NOTICE`) and link to this repository.

**Example:** If you create a competing tool based on openMemo's code, it must also be AGPL and open source.

## The network clause (the difference from GPL)

AGPL adds a **network use clause**, the strongest copyleft protection:

**If you modify openMemo and run it as a service (web app, API, SaaS), users accessing it remotely must be able to download the modified source code.**

**Example:** You cannot take openMemo, modify it, and run a closed-source SaaS version without sharing the source with users.

This prevents companies from using open source code while keeping improvements proprietary.

## Practical questions

**Q: Can I use openMemo in my business?**
A: Yes, freely. You can self-host it internally, use it in production, modify it. You just can't keep changes private.

**Q: Can I build a SaaS on top of openMemo?**
A: Only if you open source your modifications and make the source available to users. You cannot run a closed-source version.

**Q: Can I integrate openMemo into a larger closed-source application?**
A: No. Any linked/integrated code must be AGPL. The copyleft "infects" the whole work.

**Q: What if I only use openMemo as a dependency (not modify it)?**
A: If you don't modify the openMemo code, you can integrate it into other projects. But if you modify it, the copyleft applies.

**Q: Can I fork openMemo with a different name?**
A: Yes, but it must remain AGPL, preserve copyright notices, and keep the "Based on openMemo by DIR (dev.izo.red)" attribution.

## Contributing improvements

If you improve openMemo:

1. [Open a pull request](https://github.com/izored/OpenMemo) to contribute back
2. Include a summary of changes and reasoning
3. Ensure code follows project style (see `CONTRIBUTING.md`)
4. By contributing, you agree that your changes are also AGPL
