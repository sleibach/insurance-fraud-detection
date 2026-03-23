sap.ui.define(
    ["sap/ui/core/mvc/Controller", "claims/ext/formatter/pipeline"],
    function (Controller, PFmt) {
        "use strict";

        return Controller.extend("claims.ext.fragment.PipelineFlow", {
            structureState: function (s) {
                return PFmt.structureState(s);
            },
            predictState: function (s) {
                return PFmt.predictState(s);
            },
            evaluateState: function (s) {
                return PFmt.evaluateState(s);
            },
            reviewState: function (s) {
                return PFmt.reviewState(s);
            }
        });
    }
);
