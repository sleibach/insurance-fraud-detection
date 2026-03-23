sap.ui.define([], function () {
    "use strict";

    const STRUCTURE_DONE = { structured: 1, predicting: 1, predicted: 1, evaluating: 1, evaluated: 1, reviewed: 1, approved: 1, flagged: 1 };
    const PREDICT_DONE = { predicted: 1, evaluating: 1, evaluated: 1, reviewed: 1, approved: 1, flagged: 1 };
    const EVALUATE_DONE = { evaluated: 1, reviewed: 1, approved: 1, flagged: 1 };
    const REVIEW_DONE = { reviewed: 1, approved: 1, flagged: 1 };

    function resolve(statusCode, doneMap, activeCode) {
        if (!statusCode) return "None";
        if (statusCode === "failed") return "Error";
        if (doneMap[statusCode]) return "Success";
        if (statusCode === activeCode) return "Warning";
        return "None";
    }

    return {
        structureState: function (s) {
            return resolve(s, STRUCTURE_DONE, "structuring");
        },
        predictState: function (s) {
            return resolve(s, PREDICT_DONE, "predicting");
        },
        evaluateState: function (s) {
            return resolve(s, EVALUATE_DONE, "evaluating");
        },
        reviewState: function (s) {
            return resolve(s, REVIEW_DONE, null);
        }
    };
});
