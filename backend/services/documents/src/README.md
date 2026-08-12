# Documents Source

The API/persistence surface contains only candidate-owned metadata and opaque object references.
`upload-signer.ts` is the sole direct-upload capability issuer. Processing code must verify the
managed malware tag and the declared checksum before parsing and must never log filenames, bytes,
text blocks, profile proposals, or storage credentials.
