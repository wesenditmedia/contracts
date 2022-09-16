// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IStakingPool {
    function onERC20Received(address from, uint256 amount) external;
}
