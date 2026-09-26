# Reviewing and publishing Vault templates

1. Open **Marketplace** in the private growth dashboard. Filter pending
   submissions, download the private package and inspect its contents without
   executing anything. Record the review notes, then approve or reject it.
   Rejection erases quarantined package bytes; the decision is final.
2. An approved Vault template exposes a review receipt containing its immutable
   SHA-256, identity, version and reviewer. Download both the receipt and package.
3. Run the secretless validator before signing:

   ```sh
   python -m extensions.marketplace.reviewed_templates \
     --receipt review.json --package submission.gnosi-vault.zip --out reviewed
   ```

   Validation checks the receipt, archive inventory, paths, privacy exclusions
   and potential credentials. It never executes uploaded files. Keep this
   directory private and outside Git. A receipt records the human decision; it
   is not a cryptographic proof of approval, so accept receipts only through
   the authenticated dashboard and the maintainer-controlled release process.
4. The authorized release operator can include the validated directory with
   `build_vault_templates.py --reviewed-dir reviewed`. The builder revalidates
   every receipt and package before accessing the official signing key. It
   rejects duplicate template identities and includes the approved packages in
   the same signed index as the bundled catalog.
5. Verify the complete release candidate with `verify_release_candidate.py`.
   Review the package inventory and signatures before publishing the generated
   ZIPs, index and detached signature as release assets. Publish to the same
   immutable release URL passed as `--base-url`. Keep previously announced
   versioned ZIPs available; never commit uploads or signing keys to Git.

Approval is a human review state, not publication. The dashboard cannot sign
packages or modify a public release. Existing release controls remain in force.
Plugin submissions remain reviewable but are not accepted by the Vault template
builder; use the plugin release process for executable extensions.
