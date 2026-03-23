/**
 * Stub for XML tag &lt;core:require&gt; when parsed as a control child (e.g. Fiori header facet wrapper).
 * The real declarative API is the core:require *attribute* on the fragment root; there is no separate
 * sap/ui/core/require module on the CDN, so loading fails without this map target.
 */
sap.ui.define(["sap/ui/core/Control"], function (Control) {
    "use strict";

    return Control.extend("sap.ui.core.require", {
        metadata: {
            library: "sap.ui.core",
            properties: {
                module: { type: "string", defaultValue: "" }
            }
        },
        renderer: {
            apiVersion: 2,
            render: function () {}
        }
    });
});
