// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./EmergencyGuard.sol";
import "./interfaces/IWeSenditToken.sol";

abstract contract BaseWeSenditToken is
    IWeSenditToken,
    EmergencyGuard,
    AccessControlEnumerable,
    Ownable
{
    uint256 public constant INITIAL_SUPPLY = 37500000 ether;
    uint256 public constant TOTAL_SUPPLY = 1500000000 ether;

    // Role allowed to do admin operations like adding to fee whitelist, withdraw, etc.
    bytes32 public constant ADMIN = keccak256("ADMIN");

    // Role allowed to bypass pause
    bytes32 public constant BYPASS_PAUSE = keccak256("BYPASS_PAUSE");

    bool private _paused = true;
    IDynamicFeeManager private _dynamicFeeManager;

    constructor() {
        _setupRole(ADMIN, _msgSender());
        _setRoleAdmin(ADMIN, ADMIN);
        _setRoleAdmin(BYPASS_PAUSE, ADMIN);
    }

    /**
     * Getter & Setter
     */
    function initialSupply() public pure override returns (uint256) {
        return INITIAL_SUPPLY;
    }

    function paused() public view override returns (bool) {
        return _paused;
    }

    function unpause() public override onlyRole(ADMIN) {
        _paused = false;
        emit Unpaused();
    }

    function dynamicFeeManager()
        public
        view
        override
        returns (IDynamicFeeManager manager)
    {
        return _dynamicFeeManager;
    }

    function setDynamicFeeManager(address value)
        public
        override
        onlyRole(ADMIN)
    {
        _dynamicFeeManager = IDynamicFeeManager(value);
        emit DynamicFeeManagerUpdated(value);
    }

    function emergencyWithdraw(uint256 amount) public override onlyRole(ADMIN) {
        super._emergencyWithdraw(amount);
    }

    function emergencyWithdrawToken(address token, uint256 amount)
        public
        override
        onlyRole(ADMIN)
    {
        super._emergencyWithdrawToken(token, amount);
    }
}
