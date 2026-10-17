import os
W = os.environ.get('STRASS_W', os.path.dirname(os.path.abspath(__file__))) + '/'
MODELS = os.environ.get('STRASS_MODELS', W + 'models/')
