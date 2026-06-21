import joblib
import matplotlib.pyplot as plt

from sklearn.naive_bayes import GaussianNB
from sklearn.metrics import RocCurveDisplay, PrecisionRecallDisplay, roc_auc_score, classification_report, accuracy_score
from sklearn.model_selection import GridSearchCV, StratifiedKFold
from imblearn.over_sampling import SMOTE
from sklearn.pipeline import Pipeline

from dataLoader import loadExcel, prepareData, getPreprocessor

EXCEL_PATH = "../data/fraud_oracle.xlsx"
MODEL_PATH = "../models/nb_fraud_model.pkl"

def loadClassifier(path):
    return joblib.load(path)

def saveClassifier(nb, path):
    joblib.dump(nb, path)

def trainNB(train):
    X_train = prepareData(train)
    y_train = train["FraudFound_P"].values
    preprocessor = getPreprocessor()

    X_train = preprocessor.fit_transform(X_train)

    print(f"Fraud cases: {sum(y_train)}")
    print(f"No fraud cases: {len(y_train) - sum(y_train)}")
    print(f"Fraud percentage: {100 * sum(y_train) / len(y_train):.2f}%")

    smote = SMOTE(random_state=0, k_neighbors=min(5, sum(y_train)))
    X_train_balanced, y_train_balanced = smote.fit_resample(X_train, y_train)
    
    param_grid = {
        'var_smoothing': [1e-9, 1e-8, 1e-7, 1e-6, 1e-5]
    }
    
    grid_search = GridSearchCV(
        GaussianNB(),
        param_grid,      
        cv=StratifiedKFold(n_splits=3, shuffle=True, random_state=0),
        scoring='recall',      
        n_jobs=-1,
        verbose=1           
    )
    
    grid_search.fit(X_train_balanced, y_train_balanced)
    
    print(f"Best parameters: {grid_search.best_params_}")
    print(f"Best CV score: {grid_search.best_score_:.4f}")
    
    pipeline = Pipeline([
        ('preprocessor', preprocessor),
        ('classifier', grid_search.best_estimator_)
    ])
    
    return pipeline

def evaluateNB(val, nb):
    X_val = prepareData(val)
    y_val = val["FraudFound_P"].values
    
    predictions = nb.predict(X_val)
    probs = nb.predict_proba(X_val)[:, 1]
    
    print(f"ROC AUC: {roc_auc_score(y_val, probs):.4f}")
    print(f"Accuracy: {accuracy_score(y_val, predictions):.4f}")
    print(classification_report(y_val, predictions, zero_division=0))


def visualizeNB_PrecisionRecallCurve(test, nb): 

    X_test = prepareData(test)
    y_Test = test["FraudFound_P"].values

    display = PrecisionRecallDisplay.from_estimator(
        nb, X_test, y_Test, name="RFC", plot_chance_level=True, despine=True
    )
    _ = display.ax_.set_title("2-class Precision-Recall curve")
    
    plt.show()

def visualizeNB_ROCCurve(test, nb): 

    X_test = prepareData(test)
    y_Test = test["FraudFound_P"].values

    nb_disp = RocCurveDisplay.from_estimator(nb, X_test, y_Test, plot_chance_level=True) 
    plt.show()

def predict_nb(data):
    nb_pipeline = loadClassifier(MODEL_PATH)

    predictions = nb_pipeline.predict(data)
    probs = nb_pipeline.predict_proba(data)[:, 1]

    return predictions, probs

if __name__ == "__main__":

    train, test, val = loadExcel(EXCEL_PATH)

    #nb_pipeline = trainNB(train)
    #saveClassifier(nb_pipeline, MODEL_PATH)
    nb_pipeline = loadClassifier(MODEL_PATH)

    evaluateNB(val, nb_pipeline)
    visualizeNB_ROCCurve(test, nb_pipeline)
