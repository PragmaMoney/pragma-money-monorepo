// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IAgentFactory {
    event FundingConfigUpdated(uint256 indexed agentId, bool needsFunding, uint16 splitRatio);

    function poolByAgentId(uint256 agentId) external view returns (address);
    function agentCount() external view returns (uint256);
    function getAgentIdAt(uint256 index) external view returns (uint256);
    function getFundingConfig(uint256 agentId) external view returns (bool needsFunding, uint16 splitRatio);
    function setFundingConfig(uint256 agentId, bool needsFunding, uint16 splitRatio) external;
}
