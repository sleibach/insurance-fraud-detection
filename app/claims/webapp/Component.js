sap.ui.define(
    ["sap/fe/core/AppComponent", "claims/ext/formatter/pipeline"],
    function (Component) {
        "use strict";

        return Component.extend("claims.Component", {
            metadata: {
                manifest: "json"
            }
        });
    }
);