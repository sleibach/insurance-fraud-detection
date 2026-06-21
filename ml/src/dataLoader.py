import pandas as pd

from sklearn import preprocessing
from sklearn.compose import ColumnTransformer

CATEGORICAL_FEATURES = [
        "AccidentArea", 
        "Sex", 
        "Fault",
        "PoliceReportFiled", 
        "WitnessPresent", 
        "AgentType", 
        "Month", 
        "DayOfWeek", 
        "Make", 
        "MonthClaimed", 
        "DayOfWeekClaimed", 
        "MaritalStatus", 
        "PolicyType", 
        "VehicleCategory", 
        "VehiclePrice", 
        "Days_Policy_Accident", 
        "Days_Policy_Claim", 
        "AgeOfVehicle", 
        "AgeOfPolicyHolder", 
        "NumberOfSuppliments", 
        "AddressChange_Claim", 
        "NumberOfCars", 
        "BasePolicy",  
        "PastNumberOfClaims"
    ]

NUMERIC_FEATURES = [
    "WeekOfMonthClaimed",
    "Age",
    "RepNumber",
    "Deductible",
    "DriverRating"
]

def loadExcel(file):
    data = pd.read_excel(file)

    train = data[data["Training"] == "Training"].drop(columns=["Training"])
    test = data[data["Training"] == "Test"].drop(columns=["Training"])
    val = data[data["Training"] == "Validation"].drop(columns=["Training"])

    print("Training: " + str(len(train.index)))
    print("Test: " + str(len(test.index)))
    print("Validation: " + str(len(val.index)))

    return train, test, val

def getPreprocessor():
    
    preprocessor = ColumnTransformer(
        transformers=[
            ('num', preprocessing.StandardScaler(), NUMERIC_FEATURES),
            ('cat', preprocessing.OneHotEncoder(handle_unknown='ignore', sparse_output=False), CATEGORICAL_FEATURES)
        ],
        remainder='passthrough'
    )

    return preprocessor

def prepareData(data):
    
    # remove unnecessary columns
    data = data.drop(columns=["PolicyNumber","Year", "FraudFound_P"], errors='ignore')

    #ensure str type for categorical columns
    for col in CATEGORICAL_FEATURES:
        data[col] = data[col].astype(str)

    return data