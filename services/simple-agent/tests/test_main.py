from simple_agent.main import app

class TestBedrockAgentCoreApp:
    def test_app_initialization(self):
        """Test that BedrockAgentCoreApp is properly initialized"""
        assert app is not None
        assert hasattr(app, 'entrypoint')
